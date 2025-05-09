import express from 'express';
import sqlite3 from 'sqlite3';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Constants
const ALLOWED_SORT_FIELDS = ['chapters', 'rating', 'title'];
const ALLOWED_STATUSES = ['ignore', 'completed', 'incomplete', 'future'];
const ALLOWED_GENRES = ['action', 'adventure', 'fantasy', 'isekai', 'magic', 'reincarnation'];

// Database setup
const db = new sqlite3.Database('manga.db', (err) => {
    if (err) {
        console.error('Error opening database:', err);
        process.exit(1);
    }
    console.log('Connected to the SQLite database.');
});

// Initialize database
function initDb() {
    return new Promise((resolve, reject) => {
        db.exec(`
            CREATE TABLE IF NOT EXISTS comics (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                link TEXT UNIQUE NOT NULL,
                image_url TEXT,
                chapters INTEGER,
                rating REAL,
                genre TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS reading_status (
                comic_id INTEGER PRIMARY KEY,
                status TEXT CHECK(status IN ('ignore', 'completed', 'incomplete', 'future')),
                last_read_chapter INTEGER,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (comic_id) REFERENCES comics(id)
            );

            -- Add optimized indexes for better query performance
            CREATE INDEX IF NOT EXISTS idx_comics_genre ON comics(genre);
            CREATE INDEX IF NOT EXISTS idx_comics_chapters ON comics(chapters);
            CREATE INDEX IF NOT EXISTS idx_comics_rating ON comics(rating);
            CREATE INDEX IF NOT EXISTS idx_reading_status_status ON reading_status(status);
            CREATE INDEX IF NOT EXISTS idx_comics_title ON comics(title);
            CREATE INDEX IF NOT EXISTS idx_comics_created ON comics(created_at);
            CREATE INDEX IF NOT EXISTS idx_reading_status_updated ON reading_status(updated_at);
        `, (err) => {
            if (err) {
                console.error('Error initializing database:', err);
                reject(err);
            } else {
                resolve();
            }
        });
    });
}

// Validation middleware
function validateStatus(req, res, next) {
    const { status } = req.body;
    if (status && !ALLOWED_STATUSES.includes(status)) {
        return res.status(400).json({ error: 'Invalid status value' });
    }
    next();
}

function validateLastReadChapter(req, res, next) {
    const { lastReadChapter } = req.body;
    if (lastReadChapter !== undefined && (!Number.isInteger(lastReadChapter) || lastReadChapter < 0)) {
        return res.status(400).json({ error: 'Last read chapter must be a positive integer' });
    }
    next();
}

function validateComicId(req, res, next) {
    const id = parseInt(req.params.id);
    if (isNaN(id) || id <= 0) {
        return res.status(400).json({ error: 'Invalid comic ID' });
    }
    req.comicId = id;
    next();
}

// Error handling middleware
function errorHandler(err, req, res, next) {
    console.error(err.stack);
    res.status(500).json({ error: 'An unexpected error occurred' });
}

// Helper function for database queries
function queryAsync(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

function getAsync(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}

function runAsync(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function(err) {
            if (err) reject(err);
            else resolve(this);
        });
    });
}

// API Routes
app.get('/api/comics', async (req, res, next) => {
    try {
        const { status, genre, sort = 'chapters', page = 1, limit = 12 } = req.query;
        
        // Validate inputs
        if (status && !ALLOWED_STATUSES.includes(status)) {
            return res.status(400).json({ error: 'Invalid status value' });
        }
        
        if (genre && !ALLOWED_GENRES.includes(genre)) {
            return res.status(400).json({ error: 'Invalid genre value' });
        }
        
        if (!ALLOWED_SORT_FIELDS.includes(sort)) {
            return res.status(400).json({ error: 'Invalid sort field' });
        }

        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);
        
        if (isNaN(pageNum) || pageNum < 1 || isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
            return res.status(400).json({ error: 'Invalid pagination parameters' });
        }

        // Optimized query using proper indexing
        const offset = (pageNum - 1) * limitNum;
        const params = [];
        
        let baseQuery = `
            SELECT 
                c.*,
                rs.status,
                rs.last_read_chapter,
                COUNT(*) OVER() as total_count
            FROM comics c
            LEFT JOIN reading_status rs ON c.id = rs.comic_id
            WHERE 1=1
        `;
        
        if (status) {
            baseQuery += ' AND rs.status = ?';
            params.push(status);
        }
        
        if (genre) {
            baseQuery += ' AND c.genre LIKE ?';
            params.push(`%${genre}%`);
        }
        
        // Add sorting and pagination
        const sortField = ALLOWED_SORT_FIELDS.includes(sort) ? sort : 'chapters';
        baseQuery += ` ORDER BY ${sortField} DESC LIMIT ? OFFSET ?`;
        
        params.push(limitNum, offset);
        
        const comics = await queryAsync(baseQuery, params);
        
        // Extract total count from the first row (all rows will have the same count)
        const total = comics.length > 0 ? comics[0].total_count : 0;
        
        // Remove the total_count from each comic object
        const cleanedComics = comics.map(({ total_count, ...comic }) => comic);
        
        res.json({
            comics: cleanedComics,
            total,
            page: pageNum,
            limit: limitNum,
            totalPages: Math.ceil(total / limitNum)
        });
    } catch (error) {
        next(error);
    }
});

app.post('/api/comics/:id/status', 
    validateComicId,
    validateStatus,
    validateLastReadChapter,
    async (req, res, next) => {
        try {
            const { status, lastReadChapter } = req.body;
            
            // Verify comic exists
            const comic = await getAsync('SELECT id FROM comics WHERE id = ?', [req.comicId]);
            if (!comic) {
                return res.status(404).json({ error: 'Comic not found' });
            }
            
            await runAsync(`
                INSERT INTO reading_status (comic_id, status, last_read_chapter)
                VALUES (?, ?, ?)
                ON CONFLICT(comic_id) DO UPDATE SET
                status = excluded.status,
                last_read_chapter = excluded.last_read_chapter,
                updated_at = CURRENT_TIMESTAMP
            `, [req.comicId, status, lastReadChapter]);
            
            res.json({ success: true });
        } catch (error) {
            next(error);
        }
    }
);

// Apply error handling middleware
app.use(errorHandler);

// Start server
initDb().then(() => {
    app.listen(port, () => {
        console.log(`Server running at http://localhost:${port}`);
    });
}).catch(err => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
}); 
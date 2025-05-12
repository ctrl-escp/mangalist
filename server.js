import express from 'express';
import sqlite3 from 'sqlite3';
import morgan from 'morgan';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

process.on('uncaughtException', err => {
    console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', err => {
    console.error('Unhandled Rejection:', err);
});


// Middleware
app.use(morgan('combined'));
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Constants
const ALLOWED_SORT_FIELDS = ['chapters', 'rating', 'title'];
const ALLOWED_STATUSES = ['unread', 'completed', 'ongoing', 'abandoned'];
const ALLOWED_GENRES = ['action', 'adventure', 'fantasy', 'isekai', 'magic', 'reincarnation'];

// Database setup
const db = new sqlite3.Database(join(__dirname, 'manga.db'), (err) => {
    if (err) {
        console.error('Error opening database:', err);
        process.exit(1);
    }
    console.log('Connected to the SQLite database - ' + db.filename);
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

            -- Create temporary table for reading_status
            CREATE TABLE IF NOT EXISTS reading_status_temp (
                comic_id INTEGER PRIMARY KEY,
                status TEXT CHECK(status IN ('unread', 'completed', 'ongoing', 'abandoned')),
                current_chapter_url TEXT,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (comic_id) REFERENCES comics(id)
            );

            -- Migrate data from old table to new table if it exists
            INSERT OR IGNORE INTO reading_status_temp (comic_id, status, updated_at)
            SELECT comic_id, 
                   CASE 
                       WHEN status = 'completed' THEN 'completed'
                       WHEN status = 'incomplete' THEN 'ongoing'
                       WHEN status = 'future' THEN 'ongoing'
                       WHEN status = 'ignore' THEN 'abandoned'
                       ELSE 'unread'
                   END as status,
                   updated_at
            FROM reading_status;

            -- Drop old table and rename new one
            DROP TABLE IF EXISTS reading_status;
            ALTER TABLE reading_status_temp RENAME TO reading_status;

            -- Add optimized indexes for better query performance
            CREATE INDEX IF NOT EXISTS idx_comics_genre ON comics(genre);
            CREATE INDEX IF NOT EXISTS idx_comics_chapters ON comics(chapters);
            CREATE INDEX IF NOT EXISTS idx_comics_rating ON comics(rating);
            CREATE INDEX IF NOT EXISTS idx_reading_status_status ON reading_status(status);
            CREATE INDEX IF NOT EXISTS idx_comics_title ON comics(title);
            CREATE INDEX IF NOT EXISTS idx_comics_created ON comics(created_at);
            CREATE INDEX IF NOT EXISTS idx_reading_status_updated ON reading_status(updated_at);
            CREATE INDEX IF NOT EXISTS idx_comics_title_like ON comics(title COLLATE NOCASE);
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
        const { status, genre, sort = 'chapters', page = 1, limit = 12, search = '' } = req.query;
        
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

        // Optimized query using proper indexing and prepared statements
        const offset = (pageNum - 1) * limitNum;
        const params = [];
        
        let baseQuery = `
            WITH filtered_comics AS (
                SELECT 
                    c.*,
                    rs.status,
                    rs.current_chapter_url,
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

        if (search) {
            baseQuery += ' AND c.title LIKE ?';
            params.push(`%${search}%`);
        }
        
        baseQuery += `)
            SELECT * FROM filtered_comics
            ORDER BY ${sort} DESC
            LIMIT ? OFFSET ?`;
        
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
    async (req, res, next) => {
        try {
            const { status, currentChapterUrl, link } = req.body;
            
            // Verify comic exists
            const comic = await getAsync('SELECT id FROM comics WHERE id = ?', [req.comicId]);
            if (!comic) {
                return res.status(404).json({ error: 'Comic not found' });
            }

            // Start a transaction
            await runAsync('BEGIN TRANSACTION');

            try {
                // Update reading status
                await runAsync(`
                    INSERT INTO reading_status (comic_id, status, current_chapter_url)
                    VALUES (?, ?, ?)
                    ON CONFLICT(comic_id) DO UPDATE SET
                    status = excluded.status,
                    current_chapter_url = excluded.current_chapter_url,
                    updated_at = CURRENT_TIMESTAMP
                `, [req.comicId, status, currentChapterUrl]);

                // Update comic link if provided
                if (link) {
                    await runAsync('UPDATE comics SET link = ? WHERE id = ?', [link, req.comicId]);
                }

                await runAsync('COMMIT');
                res.json({ success: true });
            } catch (error) {
                await runAsync('ROLLBACK');
                throw error;
            }
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
import sqlite3 from 'sqlite3';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Database setup
const db = new sqlite3.Database('manga.db', (err) => {
    if (err) {
        console.error('Error opening database:', err);
        process.exit(1);
    }
    console.log('Connected to the SQLite database.');
});

// Helper function for database queries
function runAsync(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function(err) {
            if (err) reject(err);
            else resolve(this);
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

async function importJsonFile(filename, genre) {
    try {
        console.log(`Importing ${filename}...`);
        const filePath = path.join(__dirname, filename);
        const data = JSON.parse(await fs.readFile(filePath, 'utf8'));
        
        // Start a transaction
        await runAsync('BEGIN TRANSACTION');
        
        let imported = 0;
        let skipped = 0;
        let updated = 0;
        
        for (const item of data) {
            if (!item.link || !item.name) {
                skipped++;
                continue;
            }
            
            // Check if comic already exists
            const existing = await getAsync('SELECT id, genre FROM comics WHERE link = ?', [item.link]);
            
            if (existing) {
                // If comic exists but with different genre, update the genre
                if (!existing.genre.includes(genre)) {
                    const newGenre = existing.genre ? `${existing.genre},${genre}` : genre;
                    await runAsync('UPDATE comics SET genre = ? WHERE id = ?', [newGenre, existing.id]);
                    updated++;
                }
            } else {
                // Insert new comic
                await runAsync(`
                    INSERT INTO comics (title, link, image_url, chapters, rating, genre)
                    VALUES (?, ?, ?, ?, ?, ?)
                `, [
                    item.name,
                    item.link,
                    item.image || null,
                    item.chapters || 0,
                    item.rating || null,
                    genre
                ]);
                imported++;
            }
        }
        
        // Commit the transaction
        await runAsync('COMMIT');
        
        console.log(`Finished importing ${filename}:`);
        console.log(`- Imported: ${imported}`);
        console.log(`- Updated: ${updated}`);
        console.log(`- Skipped: ${skipped}`);
        
    } catch (error) {
        // Rollback on error
        await runAsync('ROLLBACK');
        console.error(`Error importing ${filename}:`, error);
    }
}

async function main() {
    const files = [
        { name: 'action.json', genre: 'action' },
        { name: 'adventure.json', genre: 'adventure' },
        { name: 'fantasy.json', genre: 'fantasy' },
        { name: 'isekai.json', genre: 'isekai' },
        { name: 'magic.json', genre: 'magic' }
    ];
    
    for (const file of files) {
        await importJsonFile(file.name, file.genre);
    }
    
    // Close the database connection
    db.close((err) => {
        if (err) {
            console.error('Error closing database:', err);
        } else {
            console.log('Database connection closed.');
        }
    });
}

main().catch(console.error); 
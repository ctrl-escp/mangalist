# Manga Tracker

A fullstack application for tracking manga, manhwa, and manhua titles. Keep track of your reading progress, manage your reading list, and discover new titles based on the number of available chapters.

## Features

- Browse comics sorted by number of chapters
- Track reading status:
  - Ignore (remove from view)
  - Completed
  - Incomplete (waiting for new chapters)
  - Future reading list
- Filter by genre and status
- Responsive design
- Persistent storage with SQLite database

## Prerequisites

- Node.js v22 or higher
- npm (comes with Node.js)

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd manga-tracker
```

2. Install dependencies:
```bash
npm install
```

3. Start the development server:
```bash
npm run dev
```

The application will be available at http://localhost:3000

## Project Structure

```
manga-tracker/
├── public/           # Static files
│   └── index.html    # Main application page
├── server.js         # Express server and API endpoints
├── manga.db          # SQLite database (created on first run)
├── package.json      # Project dependencies and scripts
└── README.md         # This file
```

## API Endpoints

### GET /api/comics
Get all comics with optional filtering.

Query parameters:
- `status`: Filter by reading status ('ignore', 'completed', 'incomplete', 'future')
- `genre`: Filter by genre
- `sort`: Sort field (default: 'chapters')

### POST /api/comics/:id/status
Update reading status for a comic.

Request body:
```json
{
    "status": "completed|incomplete|ignore|future",
    "lastReadChapter": 123
}
```

## Development

- `npm run dev`: Start development server with auto-reload
- `npm start`: Start production server

## License

MIT 
# Code Review Platform

A real-time code review platform that allows mentors and students to collaborate on code blocks. Built with React, FastAPI, and WebSocket for real-time communication.

## Features

- Real-time code collaboration
- Mentor-Student role system
- Live code editing
- Instant feedback
- Multiple code block support

## Prerequisites

- Node.js (v14 or higher)
- Python (v3.7 or higher)
- pip (Python package manager)
- npm (Node package manager)

## Installation

### Server Setup

1. Navigate to the server directory:

```bash
cd server
```

2. Create a virtual environment (optional but recommended):

```bash
python -m venv venv
source venv/bin/activate  # On Windows use: venv\Scripts\activate
```

3. Install dependencies:

```bash
pip install fastapi uvicorn websockets
```

### Client Setup

1. Navigate to the client directory:

```bash
cd client
```

2. Install dependencies:

```bash
npm install
```

## Running the Application

1. Start the server (from the server directory):

```bash
python main.py
```

The server will run on http://localhost:8000

2. Start the client (from the client directory):

```bash
npm start
```

The client will run on http://localhost:3000

## Usage

1. Open http://localhost:3000 in your browser
2. The first user to connect will be assigned as a mentor
3. Subsequent users will be assigned as students
4. Mentor can select code blocks and start sessions
5. Students can join sessions and participate in code reviews

## Project Structure

```
.
├── client/                 # React frontend
│   ├── src/
│   │   ├── components/    # React components
│   │   └── App.js         # Main App component
│   └── package.json       # Frontend dependencies
└── server/                # FastAPI backend
    └── main.py           # Server implementation
```

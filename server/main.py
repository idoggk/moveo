from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import json
from typing import Dict, List
import os

app = FastAPI()

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Store active connections and their roles
active_connections: Dict[str, Dict[WebSocket, str]] = {}  # room_id: {websocket: role}

# Store code blocks
CODE_BLOCKS_FILE = "code_blocks.json"

def load_code_blocks():
    if not os.path.exists(CODE_BLOCKS_FILE):
        # Create initial code blocks if file doesn't exist
        initial_blocks = {
            "code_blocks": [
                {
                    "id": "1",
                    "title": "Async case",
                    "template": "async function example() {\n  // Your code here\n}",
                    "solution": "async function example() {\n  return await Promise.resolve('success');\n}"
                },
                {
                    "id": "2",
                    "title": "Array methods",
                    "template": "const numbers = [1, 2, 3, 4, 5];\n// Your code here",
                    "solution": "const numbers = [1, 2, 3, 4, 5];\nconst doubled = numbers.map(n => n * 2);"
                },
                {
                    "id": "3",
                    "title": "Promise chain",
                    "template": "// Create a promise chain here",
                    "solution": "Promise.resolve(1)\n  .then(x => x + 1)\n  .then(x => x * 2);"
                },
                {
                    "id": "4",
                    "title": "Event handling",
                    "template": "// Add event listener here",
                    "solution": "document.addEventListener('click', () => {\n  console.log('clicked!');\n});"
                }
            ]
        }
        with open(CODE_BLOCKS_FILE, "w") as f:
            json.dump(initial_blocks, f, indent=2)
        return initial_blocks
    with open(CODE_BLOCKS_FILE, "r") as f:
        return json.load(f)

@app.get("/code-blocks")
async def get_code_blocks():
    return load_code_blocks()

@app.get("/code-blocks/{block_id}")
async def get_code_block(block_id: str):
    code_blocks = load_code_blocks()
    for block in code_blocks["code_blocks"]:
        if block["id"] == block_id:
            return block
    return {"error": "Code block not found"}

@app.websocket("/ws/{room_id}")
async def websocket_endpoint(websocket: WebSocket, room_id: str):
    await websocket.accept()
    
    # Check if this is the first connection to the room
    is_first_connection = room_id not in active_connections or not active_connections[room_id]
    
    # Initialize room if it doesn't exist
    if room_id not in active_connections:
        active_connections[room_id] = {}
    
    # Assign role based on whether this is the first connection
    role = "mentor" if is_first_connection else "student"
    active_connections[room_id][websocket] = role
    
    # Send role information to the client
    await websocket.send_text(json.dumps({
        "type": "role",
        "role": role,
        "studentCount": sum(1 for r in active_connections[room_id].values() if r == "student")
    }))
    
    try:
        while True:
            data = await websocket.receive_text()
            # Broadcast the code update to all other connections in the room
            for connection in active_connections[room_id]:
                if connection != websocket:
                    await connection.send_text(data)
    except WebSocketDisconnect:
        # Remove the disconnected connection
        del active_connections[room_id][websocket]
        # If mentor disconnects, close the room
        if not any(role == "mentor" for role in active_connections[room_id].values()):
            del active_connections[room_id]
        # If no connections left, remove the room
        if not active_connections[room_id]:
            del active_connections[room_id]

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

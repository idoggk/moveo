from fastapi import FastAPI, WebSocket, WebSocketDisconnect, status, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import json
from typing import Dict, List
import os
from starlette.websockets import WebSocketState

# Global state management
active_connections: Dict[str, Dict[WebSocket, str]] = {}  # room_id: {websocket: role}
current_editor: Dict[str, WebSocket] = {}  # room_id: websocket of current editor
assigned_roles: Dict[str, str] = {}  # client_id: role
mentor_assigned = False
lobby_connections: Dict[WebSocket, str] = {}  # websocket: client_id

CODE_BLOCKS_FILE = "code_blocks.json"

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    global mentor_assigned, assigned_roles, active_connections, current_editor, lobby_connections
    mentor_assigned = False
    assigned_roles.clear()
    active_connections.clear()
    current_editor.clear()
    lobby_connections.clear()
    yield
    # Shutdown
    mentor_assigned = False
    assigned_roles.clear()
    active_connections.clear()
    current_editor.clear()
    lobby_connections.clear()

app = FastAPI(lifespan=lifespan)

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def count_mentors() -> int:
    """Count active mentor connections"""
    return sum(1 for role in assigned_roles.values() if role == "mentor")

def load_code_blocks():
    """Load or initialize code blocks from file"""
    if not os.path.exists(CODE_BLOCKS_FILE):
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

async def broadcast_to_room(room_id: str, message: dict, exclude_websocket: WebSocket = None):
    """Broadcast message to all connections in a room"""
    if room_id in active_connections:
        for connection in active_connections[room_id]:
            if connection != exclude_websocket and connection.client_state != WebSocketState.DISCONNECTED:
                try:
                    await connection.send_text(json.dumps(message))
                except Exception:
                    pass

def get_student_count(room_id: str) -> int:
    """Get number of students in a room"""
    if room_id not in active_connections:
        return 0
    return sum(1 for role in active_connections[room_id].values() if role == "student")

async def broadcast_student_count(room_id: str):
    """Broadcast updated student count to room"""
    count = get_student_count(room_id)
    await broadcast_to_room(room_id, {
        "type": "studentCount",
        "count": count
    })

async def cleanup_room(room_id: str, websocket: WebSocket = None):
    """Clean up room state when needed"""
    global mentor_assigned
    
    if room_id in active_connections:
        if websocket:
            role = active_connections[room_id].get(websocket)
            active_connections[room_id].pop(websocket, None)
            
            if role == "mentor":
                await broadcast_to_room(room_id, {
                    "type": "mentorLeft",
                    "message": "Mentor has left the room"
                })
                
                active_connections[room_id].clear()
                if room_id in current_editor:
                    del current_editor[room_id]
                del active_connections[room_id]
                
                if count_mentors() == 0:
                    mentor_assigned = False
        
        if not active_connections.get(room_id, {}):
            if room_id in current_editor:
                del current_editor[room_id]
            if room_id in active_connections:
                del active_connections[room_id]

async def send_message(websocket: WebSocket, message: dict):
    """Send message to a WebSocket connection"""
    try:
        if websocket.client_state != WebSocketState.DISCONNECTED:
            await websocket.send_text(json.dumps(message))
    except Exception:
        pass

@app.get("/assign-role/{client_id}")
async def assign_role(client_id: str):
    """Assign role to a client"""
    global mentor_assigned
    
    if client_id in assigned_roles:
        return {"role": assigned_roles[client_id]}
    
    role = "mentor" if count_mentors() == 0 else "student"
    if role == "mentor":
        mentor_assigned = True
    
    assigned_roles[client_id] = role
    return {"role": role}

@app.get("/my-role/{client_id}")
async def get_role(client_id: str):
    """Get role for a client"""
    if client_id not in assigned_roles:
        raise HTTPException(status_code=404, detail="Role not found")
    return {"role": assigned_roles[client_id]}

@app.websocket("/ws/lobby/{client_id}")
async def lobby_websocket_endpoint(websocket: WebSocket, client_id: str):
    await websocket.accept()
    
    try:
        if client_id not in assigned_roles:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return
            
        role = assigned_roles[client_id]
        
        lobby_connections[websocket] = client_id
        
        while True:
            try:
                data = await websocket.receive_text()
                message = json.loads(data)
                
                if message["type"] == "mentorRedirect":
                    for conn, conn_client_id in lobby_connections.items():
                        if conn != websocket:
                            try:
                                if assigned_roles.get(conn_client_id) == "student":
                                    await conn.send_text(json.dumps({
                                        "type": "redirect",
                                        "blockId": message["blockId"]
                                    }))
                            except Exception as e:
                                pass

            except WebSocketDisconnect:
                break
            except Exception as e:
                continue

    except WebSocketDisconnect:
        pass
    finally:
        if websocket in lobby_connections:
            del lobby_connections[websocket]

@app.websocket("/ws/{room_id}/{client_id}")
async def websocket_endpoint(websocket: WebSocket, room_id: str, client_id: str):
    await websocket.accept()
    
    try:
        if client_id not in assigned_roles:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return
            
        role = assigned_roles[client_id]
        
        if room_id not in active_connections:
            active_connections[room_id] = {}
        
        existing_connections = list(active_connections[room_id].items())
        for existing_ws, existing_role in existing_connections:
            if existing_role == role and assigned_roles.get(client_id) == role:
                try:
                    await existing_ws.close()
                    active_connections[room_id].pop(existing_ws, None)
                except:
                    pass
        
        active_connections[room_id][websocket] = role
        
        if role == "student" and room_id not in current_editor:
            current_editor[room_id] = websocket
        
        student_count = get_student_count(room_id)
        
        initial_state = {
            "type": "role",
            "role": role,
            "studentCount": student_count,
            "canEdit": role == "student" and websocket == current_editor.get(room_id)
        }
        await send_message(websocket, initial_state)
        
        await broadcast_to_room(room_id, {
            "type": "studentCount",
            "count": student_count
        })
        
        while True:
            try:
                data = await websocket.receive_text()
                message = json.loads(data)
                
                if message["type"] == "mentorLeaving" and role == "mentor":
                    await cleanup_room(room_id, websocket)
                    break
                
                elif message["type"] == "codeUpdate" and (role == "student" and websocket == current_editor.get(room_id)):
                    await broadcast_to_room(room_id, message, websocket)
                
                elif message["type"] == "requestEdit" and role == "student":
                    current_editor[room_id] = websocket
                    for ws, r in active_connections[room_id].items():
                        if r == "student" and ws != websocket:
                            await send_message(ws, {
                                "type": "editorChange",
                                "canEdit": False
                            })
                    await send_message(websocket, {
                        "type": "editorChange",
                        "canEdit": True
                    })

            except WebSocketDisconnect:
                break
            except Exception as e:
                continue

    except WebSocketDisconnect:
        pass
    finally:
        if room_id in active_connections and websocket in active_connections[room_id]:
            disconnected_role = active_connections[room_id][websocket]
            
            if room_id in current_editor and current_editor[room_id] == websocket:
                students = [ws for ws, r in active_connections[room_id].items() 
                          if r == "student" and ws != websocket]
                if students:
                    current_editor[room_id] = students[0]
                    await send_message(current_editor[room_id], {
                        "type": "editorChange",
                        "canEdit": True
                    })
            
            await cleanup_room(room_id, websocket)
            
            if room_id in active_connections:
                await broadcast_student_count(room_id)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

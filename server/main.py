import logging
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, status, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import json
from typing import Dict, List
import os
from starlette.websockets import WebSocketState

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler('server.log')
    ]
)
logger = logging.getLogger(__name__)

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
current_editor: Dict[str, WebSocket] = {}  # room_id: websocket of current editor
assigned_roles: Dict[str, str] = {}  # client_id: role
mentor_assigned = False  # Global flag to track if a mentor has been assigned
lobby_connections: Dict[WebSocket, str] = {}  # websocket: client_id

# Store code blocks
CODE_BLOCKS_FILE = "code_blocks.json"

@app.on_event("startup")
async def startup_event():
    """Reset global state when server starts"""
    global mentor_assigned, assigned_roles, active_connections, current_editor, lobby_connections
    mentor_assigned = False
    assigned_roles.clear()
    active_connections.clear()
    current_editor.clear()
    lobby_connections.clear()
    logger.info("Server started - All state reset")

@app.on_event("shutdown")
async def shutdown_event():
    """Reset global state when server shuts down"""
    global mentor_assigned, assigned_roles, active_connections, current_editor, lobby_connections
    mentor_assigned = False
    assigned_roles.clear()
    active_connections.clear()
    current_editor.clear()
    lobby_connections.clear()
    logger.info("Server shutdown - All state reset")

def count_mentors() -> int:
    """Count the number of active mentor connections"""
    return sum(1 for role in assigned_roles.values() if role == "mentor")

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

async def broadcast_to_room(room_id: str, message: dict, exclude_websocket: WebSocket = None):
    """Helper function to broadcast message to all connections in a room"""
    if room_id in active_connections:
        for connection in active_connections[room_id]:
            if connection != exclude_websocket:
                try:
                    if connection.client_state != WebSocketState.DISCONNECTED:
                        await connection.send_text(json.dumps(message))
                except Exception as e:
                    print(f"Error broadcasting to client: {e}")

def get_student_count(room_id: str) -> int:
    """Helper function to get the number of students in a room"""
    if room_id not in active_connections:
        return 0
    student_count = sum(1 for role in active_connections[room_id].values() if role == "student")
    logger.info(f"Room {room_id} - Student count: {student_count}")
    logger.info(f"Active connections in room: {[{ws: role} for ws, role in active_connections[room_id].items()]}")
    return student_count

async def broadcast_student_count(room_id: str):
    """Helper function to broadcast updated student count to all connections in a room"""
    count = get_student_count(room_id)
    await broadcast_to_room(room_id, {
        "type": "studentCount",
        "count": count
    })
    logger.info(f"Broadcasted student count update: {count} for room {room_id}")

async def cleanup_room(room_id: str, websocket: WebSocket = None):
    """Helper function to clean up a room when needed"""
    global mentor_assigned
    
    logger.info(f"\n{'='*50}")
    logger.info(f"Cleanup Room - Room ID: {room_id}")
    logger.info(f"Current State:")
    logger.info(f"  mentor_assigned: {mentor_assigned}")
    logger.info(f"  assigned_roles: {assigned_roles}")
    
    if room_id in active_connections:
        if websocket:
            # Get role before removing
            role = active_connections[room_id].get(websocket)
            # Remove specific connection
            active_connections[room_id].pop(websocket, None)
            logger.info(f"Removed {role} websocket connection from room {room_id}")
            
            # If this was the mentor, clean up the room
            if role == "mentor":
                await broadcast_to_room(room_id, {
                    "type": "mentorLeft"
                })
                # Clear the room entirely when mentor leaves
                active_connections[room_id].clear()
                if room_id in current_editor:
                    del current_editor[room_id]
                del active_connections[room_id]
                logger.info(f"Mentor left - cleared room {room_id}")
                
                # Reset mentor_assigned if no other mentors exist
                if count_mentors() == 0:
                    mentor_assigned = False
                    logger.info("No mentors remaining - Reset mentor_assigned flag")
        
        # If room is empty, clean it up
        if not active_connections.get(room_id, {}):
            if room_id in current_editor:
                del current_editor[room_id]
            if room_id in active_connections:
                del active_connections[room_id]
            logger.info(f"Room {room_id} is empty - removed room")
    
    logger.info(f"Final State:")
    logger.info(f"  mentor_assigned: {mentor_assigned}")
    logger.info(f"  assigned_roles: {assigned_roles}")
    logger.info(f"{'='*50}\n")

async def send_message(websocket: WebSocket, message: dict):
    """Helper function to safely send a message to a WebSocket"""
    try:
        if websocket.client_state != WebSocketState.DISCONNECTED:
            await websocket.send_text(json.dumps(message))
    except Exception as e:
        print(f"Error sending message to client: {e}")

@app.get("/assign-role/{client_id}")
async def assign_role(client_id: str):
    """Assign a role to a client when they enter the lobby"""
    global mentor_assigned
    
    logger.info(f"\n{'='*50}")
    logger.info(f"Role Assignment Request - Client ID: {client_id}")
    logger.info(f"Current State:")
    logger.info(f"  mentor_assigned: {mentor_assigned}")
    logger.info(f"  assigned_roles: {assigned_roles}")
    
    # If client already has a role, return it
    if client_id in assigned_roles:
        role = assigned_roles[client_id]
        logger.info(f"Client {client_id} already has role: {role}")
        return {"role": role}
    
    # Count current mentors
    mentor_count = count_mentors()
    logger.info(f"Current mentor count: {mentor_count}")
    
    # Assign role based on mentor count
    if mentor_count == 0:
        role = "mentor"
        mentor_assigned = True
        logger.info(f"No mentors exist - Assigning MENTOR role to {client_id}")
    else:
        role = "student"
        logger.info(f"Mentor exists - Assigning STUDENT role to {client_id}")
    
    assigned_roles[client_id] = role
    
    logger.info(f"Final State:")
    logger.info(f"  mentor_assigned: {mentor_assigned}")
    logger.info(f"  assigned_roles: {assigned_roles}")
    logger.info(f"{'='*50}\n")
    
    return {"role": role}

@app.get("/my-role/{client_id}")
async def get_role(client_id: str):
    """Get the role for a specific client"""
    if client_id not in assigned_roles:
        raise HTTPException(status_code=404, detail="Role not found")
    return {"role": assigned_roles[client_id]}

@app.websocket("/ws/lobby/{client_id}")
async def lobby_websocket_endpoint(websocket: WebSocket, client_id: str):
    await websocket.accept()
    logger.info(f"\n{'='*50}")
    logger.info(f"Lobby WebSocket Connection - Client: {client_id}")
    
    try:
        if client_id not in assigned_roles:
            logger.warning(f"Client {client_id} not found in assigned_roles - closing connection")
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return
            
        role = assigned_roles[client_id]
        logger.info(f"Retrieved role for client {client_id}: {role}")
        
        # Store connection in lobby_connections
        lobby_connections[websocket] = client_id
        logger.info(f"Added {role} to lobby connections: {client_id}")
        
        while True:
            try:
                data = await websocket.receive_text()
                message = json.loads(data)
                logger.info(f"Received lobby message from {client_id}: {message}")
                
                if message["type"] == "mentorRedirect":
                    # Broadcast redirect to all connected clients in lobby
                    for conn, conn_client_id in lobby_connections.items():
                        if conn != websocket:  # Don't send to the mentor
                            try:
                                # Only redirect if the client is a student
                                if assigned_roles.get(conn_client_id) == "student":
                                    await conn.send_text(json.dumps({
                                        "type": "redirect",
                                        "blockId": message["blockId"]
                                    }))
                            except Exception as e:
                                logger.error(f"Error sending redirect to client: {e}")
                    logger.info(f"Broadcasted redirect to block {message['blockId']} to all students")

            except WebSocketDisconnect:
                logger.info(f"Lobby WebSocket disconnected for {client_id}")
                break
            except Exception as e:
                logger.error(f"Error handling lobby message: {e}")
                continue

    except WebSocketDisconnect:
        logger.warning(f"Lobby WebSocket disconnected during setup for {client_id}")
    except Exception as e:
        logger.error(f"Error in lobby WebSocket connection for {client_id}: {e}")
    finally:
        if websocket in lobby_connections:
            del lobby_connections[websocket]
            logger.info(f"Removed {client_id} from lobby connections")
        logger.info(f"{'='*50}\n")

@app.websocket("/ws/{room_id}/{client_id}")
async def websocket_endpoint(websocket: WebSocket, room_id: str, client_id: str):
    await websocket.accept()
    logger.info(f"\n{'='*50}")
    logger.info(f"WebSocket Connection - Room: {room_id}, Client: {client_id}")
    logger.info("Current State:")
    logger.info(f"  assigned_roles: {assigned_roles}")
    logger.info(f"  active_connections: {[{k: list(v.values())} for k, v in active_connections.items()]}")
    
    try:
        # Get the pre-assigned role
        if client_id not in assigned_roles:
            logger.warning(f"Client {client_id} not found in assigned_roles - closing connection")
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return
            
        role = assigned_roles[client_id]
        logger.info(f"Retrieved role for client {client_id}: {role}")
        
        # Initialize room if it doesn't exist
        if room_id not in active_connections:
            active_connections[room_id] = {}
            logger.info(f"Created new room: {room_id}")
        
        # Check if client is already in the room
        existing_connections = list(active_connections[room_id].items())
        for existing_ws, existing_role in existing_connections:
            if existing_role == role and assigned_roles.get(client_id) == role:
                logger.warning(f"Client {client_id} already in room - closing old connection")
                try:
                    await existing_ws.close()
                    active_connections[room_id].pop(existing_ws, None)
                except:
                    pass
        
        # Add new connection
        active_connections[room_id][websocket] = role
        logger.info(f"Added {role} to room {room_id}")
        logger.info(f"Current connections in room {room_id}: {active_connections[room_id]}")

        # If this is a student and there's no current editor, make them the current editor
        if role == "student" and room_id not in current_editor:
            current_editor[room_id] = websocket
            logger.info(f"Set student as current editor in room {room_id}")
        
        # Get current student count
        student_count = get_student_count(room_id)
        
        # Send initial state to the client
        initial_state = {
            "type": "role",
            "role": role,
            "studentCount": student_count,
            "canEdit": role == "student" and websocket == current_editor.get(room_id)
        }
        await send_message(websocket, initial_state)
        logger.info(f"Sent initial state to client: {initial_state}")
        
        # Broadcast updated student count to ALL connections in the room
        await broadcast_to_room(room_id, {
            "type": "studentCount",
            "count": student_count
        })
        logger.info(f"Broadcasted student count update: {student_count} for room {room_id}")
        
        while True:
            try:
                data = await websocket.receive_text()
                message = json.loads(data)
                logger.info(f"Received message in room {room_id}: {message}")
                
                if message["type"] == "mentorLeaving" and role == "mentor":
                    # Clean up the room when mentor explicitly leaves
                    await cleanup_room(room_id, websocket)
                    break
                
                elif message["type"] == "codeUpdate" and (role == "student" and websocket == current_editor.get(room_id)):
                    await broadcast_to_room(room_id, message, websocket)
                    logger.info(f"Broadcasted code update from {role}")
                
                elif message["type"] == "requestEdit" and role == "student":
                    if room_id in current_editor and current_editor[room_id] != websocket:
                        current_editor[room_id] = websocket
                        await broadcast_to_room(room_id, {
                            "type": "editorChange",
                            "canEdit": False
                        })
                        await send_message(websocket, {
                            "type": "editorChange",
                            "canEdit": True
                        })
                        logger.info(f"Changed editor in room {room_id}")

            except WebSocketDisconnect:
                logger.info(f"WebSocket disconnected in room {room_id}")
                break
            except Exception as e:
                logger.error(f"Error handling message in room {room_id}: {e}")
                continue

    except WebSocketDisconnect:
        logger.warning(f"WebSocket disconnected during setup in room {room_id}")
    except Exception as e:
        logger.error(f"Error in WebSocket connection for room {room_id}: {e}")
    finally:
        # Handle disconnection
        if room_id in active_connections and websocket in active_connections[room_id]:
            disconnected_role = active_connections[room_id][websocket]
            logger.info(f"Cleaning up {disconnected_role} connection in room {room_id}")
            
            # If this was the current editor, select a new one
            if room_id in current_editor and current_editor[room_id] == websocket:
                students = [ws for ws, r in active_connections[room_id].items() 
                          if r == "student" and ws != websocket]
                if students:
                    current_editor[room_id] = students[0]
                    await send_message(current_editor[room_id], {
                        "type": "editorChange",
                        "canEdit": True
                    })
                    logger.info(f"Selected new editor in room {room_id}")
            
            # Clean up the room
            await cleanup_room(room_id, websocket)
            
            # Update student count for remaining connections
            if room_id in active_connections:
                await broadcast_student_count(room_id)
                logger.info(f"Updated student count after disconnect: {get_student_count(room_id)}")
        
        logger.info(f"{'='*50}\n")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

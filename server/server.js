const express = require("express");
const { WebSocketServer } = require("ws");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const http = require("http");

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Enable CORS
app.use(cors());
app.use(express.json());

// Global state management
const activeConnections = new Map(); // room_id -> Map(websocket -> role)
const currentEditor = new Map(); // room_id -> websocket
const assignedRoles = new Map(); // client_id -> role
let mentorAssigned = false;
const lobbyConnections = new Map(); // websocket -> client_id

const CODE_BLOCKS_FILE = "code_blocks.json";

// Helper functions
function countMentors() {
  return Array.from(assignedRoles.values()).filter((role) => role === "mentor")
    .length;
}

function getStudentCount(roomId) {
  if (!activeConnections.has(roomId)) return 0;
  return Array.from(activeConnections.get(roomId).values()).filter(
    (role) => role === "student"
  ).length;
}

function loadCodeBlocks() {
  if (!fs.existsSync(CODE_BLOCKS_FILE)) {
    const initialBlocks = {
      code_blocks: [
        {
          id: "1",
          title: "Async case",
          template: "async function example() {\n  // Your code here\n}",
          solution:
            "async function example() {\n  return await Promise.resolve('success');\n}",
        },
        {
          id: "2",
          title: "Array methods",
          template: "const numbers = [1, 2, 3, 4, 5];\n// Your code here",
          solution:
            "const numbers = [1, 2, 3, 4, 5];\nconst doubled = numbers.map(n => n * 2);",
        },
        {
          id: "3",
          title: "Promise chain",
          template: "// Create a promise chain here",
          solution:
            "Promise.resolve(1)\n  .then(x => x + 1)\n  .then(x => x * 2);",
        },
        {
          id: "4",
          title: "Event handling",
          template: "// Add event listener here",
          solution:
            "document.addEventListener('click', () => {\n  console.log('clicked!');\n});",
        },
      ],
    };
    fs.writeFileSync(CODE_BLOCKS_FILE, JSON.stringify(initialBlocks, null, 2));
    return initialBlocks;
  }
  return JSON.parse(fs.readFileSync(CODE_BLOCKS_FILE, "utf8"));
}

// Broadcast functions
function broadcastToRoom(roomId, message, excludeWs = null) {
  if (activeConnections.has(roomId)) {
    for (const [ws, _] of activeConnections.get(roomId).entries()) {
      if (ws !== excludeWs && ws.readyState === 1) {
        ws.send(JSON.stringify(message));
      }
    }
  }
}

function broadcastStudentCount(roomId) {
  const count = getStudentCount(roomId);
  broadcastToRoom(roomId, {
    type: "studentCount",
    count,
  });
}

// Room cleanup
function cleanupRoom(roomId, ws = null) {
  if (activeConnections.has(roomId)) {
    if (ws) {
      const role = activeConnections.get(roomId).get(ws);
      activeConnections.get(roomId).delete(ws);

      if (role === "mentor") {
        broadcastToRoom(roomId, {
          type: "mentorLeft",
          message: "Mentor has left the room",
        });

        activeConnections.get(roomId).clear();
        currentEditor.delete(roomId);
        activeConnections.delete(roomId);

        if (countMentors() === 0) {
          mentorAssigned = false;
        }
      }
    }

    if (
      activeConnections.has(roomId) &&
      activeConnections.get(roomId).size === 0
    ) {
      currentEditor.delete(roomId);
      activeConnections.delete(roomId);
    }
  }
}

// REST endpoints
app.get("/code-blocks", (req, res) => {
  res.json(loadCodeBlocks());
});

app.get("/code-blocks/:blockId", (req, res) => {
  const blocks = loadCodeBlocks();
  const block = blocks.code_blocks.find((b) => b.id === req.params.blockId);
  if (block) {
    res.json(block);
  } else {
    res.status(404).json({ error: "Code block not found" });
  }
});

app.get("/assign-role/:clientId", (req, res) => {
  const { clientId } = req.params;

  if (assignedRoles.has(clientId)) {
    return res.json({ role: assignedRoles.get(clientId) });
  }

  const role = countMentors() === 0 ? "mentor" : "student";
  if (role === "mentor") {
    mentorAssigned = true;
  }

  assignedRoles.set(clientId, role);
  res.json({ role });
});

app.get("/my-role/:clientId", (req, res) => {
  const { clientId } = req.params;
  if (!assignedRoles.has(clientId)) {
    return res.status(404).json({ error: "Role not found" });
  }
  res.json({ role: assignedRoles.get(clientId) });
});

// WebSocket handling
wss.on("connection", (ws, req) => {
  const url = new URL(req.url, "http://localhost");
  const pathParts = url.pathname.split("/");

  if (pathParts[1] === "ws" && pathParts[2] === "lobby") {
    const clientId = pathParts[3];
    handleLobbyConnection(ws, clientId);
  } else if (pathParts[1] === "ws") {
    const roomId = pathParts[2];
    const clientId = pathParts[3];
    handleRoomConnection(ws, roomId, clientId);
  }
});

function handleLobbyConnection(ws, clientId) {
  if (!assignedRoles.has(clientId)) {
    ws.close(1008);
    return;
  }

  lobbyConnections.set(ws, clientId);

  ws.on("message", (data) => {
    try {
      const message = JSON.parse(data);
      if (message.type === "mentorRedirect") {
        for (const [conn, connClientId] of lobbyConnections.entries()) {
          if (conn !== ws && assignedRoles.get(connClientId) === "student") {
            conn.send(
              JSON.stringify({
                type: "redirect",
                blockId: message.blockId,
              })
            );
          }
        }
      }
    } catch (e) {
      console.error("Error processing message:", e);
    }
  });

  ws.on("close", () => {
    lobbyConnections.delete(ws);
  });
}

function handleRoomConnection(ws, roomId, clientId) {
  if (!assignedRoles.has(clientId)) {
    ws.close(1008);
    return;
  }

  const role = assignedRoles.get(clientId);

  if (!activeConnections.has(roomId)) {
    activeConnections.set(roomId, new Map());
  }

  // Handle existing connections with same role
  for (const [existingWs, existingRole] of activeConnections
    .get(roomId)
    .entries()) {
    if (existingRole === role && assignedRoles.get(clientId) === role) {
      existingWs.close();
      activeConnections.get(roomId).delete(existingWs);
    }
  }

  activeConnections.get(roomId).set(ws, role);

  if (role === "student" && !currentEditor.has(roomId)) {
    currentEditor.set(roomId, ws);
  }

  const studentCount = getStudentCount(roomId);

  // Send initial state
  ws.send(
    JSON.stringify({
      type: "role",
      role,
      studentCount,
      canEdit: role === "student" && currentEditor.get(roomId) === ws,
    })
  );

  broadcastToRoom(roomId, {
    type: "studentCount",
    count: studentCount,
  });

  ws.on("message", (data) => {
    try {
      const message = JSON.parse(data);

      if (message.type === "mentorLeaving" && role === "mentor") {
        cleanupRoom(roomId, ws);
        ws.close();
      } else if (
        message.type === "codeUpdate" &&
        role === "student" &&
        currentEditor.get(roomId) === ws
      ) {
        broadcastToRoom(roomId, message, ws);
      } else if (message.type === "requestEdit" && role === "student") {
        currentEditor.set(roomId, ws);

        for (const [otherWs, otherRole] of activeConnections
          .get(roomId)
          .entries()) {
          if (otherRole === "student" && otherWs !== ws) {
            otherWs.send(
              JSON.stringify({
                type: "editorChange",
                canEdit: false,
              })
            );
          }
        }

        ws.send(
          JSON.stringify({
            type: "editorChange",
            canEdit: true,
          })
        );
      }
    } catch (e) {
      console.error("Error processing message:", e);
    }
  });

  ws.on("close", () => {
    if (
      activeConnections.has(roomId) &&
      activeConnections.get(roomId).has(ws)
    ) {
      const disconnectedRole = activeConnections.get(roomId).get(ws);

      if (currentEditor.get(roomId) === ws) {
        const students = Array.from(
          activeConnections.get(roomId).entries()
        ).filter(([otherWs, role]) => role === "student" && otherWs !== ws);

        if (students.length > 0) {
          currentEditor.set(roomId, students[0][0]);
          students[0][0].send(
            JSON.stringify({
              type: "editorChange",
              canEdit: true,
            })
          );
        }
      }

      cleanupRoom(roomId, ws);

      if (activeConnections.has(roomId)) {
        broadcastStudentCount(roomId);
      }
    }
  });
}

const PORT = process.env.PORT || 8000;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

import React, { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { v4 as uuidv4 } from "uuid";
import "./Lobby.css";

const Lobby = () => {
  const [codeBlocks, setCodeBlocks] = useState([]);
  const [error, setError] = useState(null);
  const [role, setRole] = useState(null);
  const [clientId] = useState(() => {
    const stored = sessionStorage.getItem("clientId");
    if (stored) return stored;
    const newId = uuidv4();
    sessionStorage.setItem("clientId", newId);
    return newId;
  });
  const navigate = useNavigate();
  const wsRef = useRef(null);
  const reconnectAttempts = useRef(0);
  const maxReconnectAttempts = 3;

  const connectWebSocket = () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(`ws://localhost:8000/ws/lobby/${clientId}`);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log("WebSocket connected in Lobby");
      reconnectAttempts.current = 0;
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log("Received message in Lobby:", data);

        if (data.type === "redirect") {
          console.log("Redirecting to code block:", data.blockId);
          navigate(`/code/${data.blockId}`);
        }
      } catch (err) {
        console.error("Error handling WebSocket message:", err);
      }
    };

    ws.onclose = () => {
      console.log("WebSocket disconnected in Lobby");
      if (reconnectAttempts.current < maxReconnectAttempts) {
        reconnectAttempts.current++;
        setTimeout(connectWebSocket, 1000 * reconnectAttempts.current);
      } else {
        setError("Failed to maintain WebSocket connection");
      }
    };

    ws.onerror = (error) => {
      console.error("WebSocket error:", error);
      setError("WebSocket connection error");
    };
  };

  useEffect(() => {
    const fetchCodeBlocks = async () => {
      try {
        const response = await fetch("http://localhost:8000/code-blocks");
        if (!response.ok) throw new Error("Failed to fetch code blocks");
        const data = await response.json();
        setCodeBlocks(data.code_blocks || []);
      } catch (err) {
        setError("Failed to load code blocks");
        console.error("Error fetching code blocks:", err);
      }
    };

    const assignRole = async () => {
      try {
        const response = await fetch(
          `http://localhost:8000/assign-role/${clientId}`
        );
        if (!response.ok) throw new Error("Failed to assign role");
        const data = await response.json();
        setRole(data.role);
        sessionStorage.setItem("userRole", data.role);

        // Connect WebSocket for both mentors and students
        connectWebSocket();
      } catch (err) {
        setError("Failed to assign role");
        console.error("Error assigning role:", err);
      }
    };

    fetchCodeBlocks();
    assignRole();

    return () => {
      if (wsRef.current) {
        console.log("Cleaning up WebSocket connection in Lobby");
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [clientId, navigate]);

  const handleBlockClick = (blockId) => {
    if (role !== "mentor") return;

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      console.log("Mentor selected block:", blockId);
      wsRef.current.send(
        JSON.stringify({
          type: "mentorRedirect",
          blockId: blockId,
        })
      );
      navigate(`/code/${blockId}`);
    } else {
      setError("WebSocket connection is not available");
    }
  };

  if (error) {
    return (
      <div className="lobby-container">
        <div className="error-message">{error}</div>
      </div>
    );
  }

  return (
    <div className="lobby-container">
      <h1>Code Blocks Lobby</h1>
      <div className="role-display">
        Your role:{" "}
        <span className={`role ${role}`}>{role || "loading..."}</span>
      </div>
      <div className="code-blocks-grid">
        {codeBlocks.map((block) => (
          <div
            key={block.id}
            className={`code-block-card ${
              role === "mentor" ? "clickable" : ""
            }`}
            onClick={() => role === "mentor" && handleBlockClick(block.id)}
          >
            <h3>{block.title || `Block ${block.id}`}</h3>
            <p>
              {role === "mentor"
                ? "Click to start session"
                : "Waiting for mentor to start session"}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
};

export default Lobby;

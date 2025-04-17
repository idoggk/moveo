import React, { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { v4 as uuidv4 } from "uuid";
import "./Lobby.css";

const BASE_WS_URL = "ws://localhost:8000";
const BASE_API_URL = "http://localhost:8000";

const Lobby = () => {
  const [codeBlocks, setCodeBlocks] = useState([]);
  const [error, setError] = useState(null);
  const [role, setRole] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
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
  const reconnectTimeoutRef = useRef(null);

  const connectWebSocket = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      setIsConnected(true);
      return;
    }

    // Clear any existing connection
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    try {
      const ws = new WebSocket(`${BASE_WS_URL}/ws/lobby/${clientId}`);
      wsRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
        setError(null);
        reconnectAttempts.current = 0;
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === "redirect") {
            if (clientId) {
              const currentRole = sessionStorage.getItem("userRole");
              if (!currentRole) {
                sessionStorage.setItem("userRole", role);
              }
              sessionStorage.setItem("clientId", clientId);
              navigate(`/code/${data.blockId}`);
            } else {
              setError("No client ID available for redirect");
            }
          }
        } catch (err) {
          setError("Error processing server message");
        }
      };

      ws.onclose = (event) => {
        setIsConnected(false);
        if (event.code === 1000) return; // Clean close

        if (reconnectAttempts.current < maxReconnectAttempts) {
          reconnectTimeoutRef.current = setTimeout(() => {
            reconnectAttempts.current++;
            connectWebSocket();
          }, 1000 * Math.min(reconnectAttempts.current + 1, 5));
        } else {
          setError("Failed to maintain connection. Please refresh the page.");
        }
      };

      ws.onerror = () => {
        setError("Connection error. Attempting to reconnect...");
        setIsConnected(false);
      };
    } catch (err) {
      setError("Failed to establish connection");
      setIsConnected(false);
    }
  }, [clientId, navigate, role]);

  useEffect(() => {
    const fetchCodeBlocks = async () => {
      try {
        const response = await fetch(`${BASE_API_URL}/code-blocks`);
        if (!response.ok) throw new Error("Failed to fetch code blocks");
        const data = await response.json();
        setCodeBlocks(data.code_blocks || []);
      } catch (err) {
        setError("Failed to load code blocks");
      }
    };

    const assignRole = async () => {
      try {
        const response = await fetch(`${BASE_API_URL}/assign-role/${clientId}`);
        if (!response.ok) throw new Error("Failed to assign role");
        const data = await response.json();
        setRole(data.role);
        sessionStorage.setItem("userRole", data.role);
        connectWebSocket();
      } catch (err) {
        setError("Failed to assign role");
      }
    };

    sessionStorage.removeItem("userRole");
    fetchCodeBlocks();
    assignRole();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close(1000, "Component unmounting");
        wsRef.current = null;
      }
    };
  }, [clientId, connectWebSocket]);

  const handleBlockClick = (blockId) => {
    if (role !== "mentor") return;

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: "mentorRedirect",
          blockId: blockId,
        })
      );
      navigate(`/code/${blockId}`);
    } else {
      setError("Connection is not available");
    }
  };

  if (error) {
    return (
      <div className="lobby-container">
        <div className="error-message">
          {error}
          {!isConnected && (
            <button onClick={connectWebSocket} className="retry-button">
              Retry Connection
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="lobby-container">
      <h1>Choose Code Block</h1>
      <div className="role-display">
        Your role:{" "}
        <span className={`role ${role}`}>
          {role || "loading..."}
          {!isConnected && " (Disconnected)"}
        </span>
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

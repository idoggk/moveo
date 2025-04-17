import React, { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import axios from "axios";
import Editor from "react-simple-code-editor";
import { highlight, languages } from "prismjs";
import "prismjs/components/prism-javascript";
import "prismjs/themes/prism.css";
import "prismjs/themes/prism-tomorrow.css";

const BASE_WS_URL = "ws://localhost:8000";
const BASE_API_URL = "http://localhost:8000";

const CodeBlock = () => {
  const [codeBlock, setCodeBlock] = useState(null);
  const [error, setError] = useState("");
  const [role, setRole] = useState(
    () => sessionStorage.getItem("userRole") || ""
  );
  const [studentCount, setStudentCount] = useState(0);
  const [isSolutionCorrect, setIsSolutionCorrect] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const ws = useRef(null);
  const reconnectAttempts = useRef(0);
  const maxReconnectAttempts = 3;
  const reconnectTimeoutRef = useRef(null);
  const { blockId } = useParams();
  const navigate = useNavigate();

  const handleBackToLobby = () => {
    if (ws.current) {
      if (role === "mentor") {
        ws.current.send(
          JSON.stringify({
            type: "mentorLeaving",
            blockId: blockId,
          })
        );
      }
      ws.current.close(1000, "User leaving");
      ws.current = null;
    }
    setCodeBlock(null);
    setStudentCount(0);
    setCanEdit(false);
    setIsConnected(false);
    navigate("/");
  };

  const connectWebSocket = useCallback(() => {
    const clientId = sessionStorage.getItem("clientId");

    if (!clientId) {
      setError("Session expired. Please return to lobby.");
      setTimeout(() => navigate("/"), 2000);
      return;
    }

    if (ws.current?.readyState === WebSocket.OPEN) {
      setIsConnected(true);
      return;
    }

    // Clear any existing connection
    if (ws.current) {
      ws.current.close();
      ws.current = null;
    }

    try {
      ws.current = new WebSocket(`${BASE_WS_URL}/ws/${blockId}/${clientId}`);

      ws.current.onopen = () => {
        setIsConnected(true);
        setError("");
        reconnectAttempts.current = 0;
      };

      ws.current.onerror = () => {
        setError("Connection error. Attempting to reconnect...");
        setIsConnected(false);
      };

      ws.current.onclose = (event) => {
        setIsConnected(false);

        if (event.code === 1000) return;

        if (reconnectAttempts.current < maxReconnectAttempts) {
          reconnectTimeoutRef.current = setTimeout(() => {
            reconnectAttempts.current += 1;
            connectWebSocket();
          }, 1000 * Math.min(reconnectAttempts.current + 1, 5));
        } else {
          setError(
            "Connection lost. Please refresh the page or return to lobby."
          );
        }
      };

      ws.current.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          switch (data.type) {
            case "codeUpdate":
              setCodeBlock((prev) => ({ ...prev, template: data.code }));
              break;
            case "role":
              setRole(data.role);
              setStudentCount(data.studentCount || 0);
              setCanEdit(data.role === "student" && data.canEdit);
              break;
            case "studentCount":
              setStudentCount(data.count);
              break;
            case "mentorLeft":
              setCodeBlock(null);
              setStudentCount(0);
              setCanEdit(false);
              setIsConnected(false);
              if (ws.current) {
                ws.current.close(1000, "Mentor left");
                ws.current = null;
              }
              sessionStorage.clear();
              navigate("/", { replace: true });
              break;
            case "editorChange":
              setCanEdit(role === "student" && data.canEdit);
              break;
          }
        } catch (err) {
          setError("Error processing server message");
        }
      };
    } catch (err) {
      setError("Failed to establish connection");
      setIsConnected(false);
    }
  }, [blockId, navigate, role]);

  useEffect(() => {
    let isActive = true;

    const fetchCodeBlock = async () => {
      try {
        const response = await axios.get(
          `${BASE_API_URL}/code-blocks/${blockId}`
        );
        if (response.data && isActive) {
          setCodeBlock(response.data);
        }
      } catch (err) {
        if (isActive) {
          setError("Failed to load code block. Please try again later.");
        }
      }
    };

    const verifyRole = async () => {
      const clientId = sessionStorage.getItem("clientId");

      if (!clientId) {
        setError("Session expired. Please return to lobby.");
        setTimeout(() => navigate("/"), 2000);
        return false;
      }

      try {
        const response = await fetch(`${BASE_API_URL}/my-role/${clientId}`);
        if (!response.ok) throw new Error("Failed to verify role");

        const data = await response.json();
        sessionStorage.setItem("userRole", data.role);
        setRole(data.role);
        return true;
      } catch (err) {
        setError("Failed to verify role. Please return to lobby.");
        setTimeout(() => navigate("/"), 2000);
        return false;
      }
    };

    const init = async () => {
      if (!isActive) return;

      const isRoleValid = await verifyRole();
      if (!isActive || !isRoleValid) return;

      await fetchCodeBlock();
      if (!isActive) return;

      connectWebSocket();
    };

    init();

    return () => {
      isActive = false;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (ws.current) {
        ws.current.close(1000, "Component unmounting");
        ws.current = null;
      }
      reconnectAttempts.current = maxReconnectAttempts;
    };
  }, [blockId, navigate, connectWebSocket]);

  const handleCodeChange = (newCode) => {
    if (!canEdit) return;

    setCodeBlock((prev) => ({ ...prev, template: newCode }));

    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(
        JSON.stringify({
          type: "codeUpdate",
          code: newCode,
        })
      );
    }

    if (newCode.trim() === codeBlock?.solution?.trim()) {
      setIsSolutionCorrect(true);
    } else {
      setIsSolutionCorrect(false);
    }
  };

  const requestEdit = () => {
    if (
      role === "student" &&
      !canEdit &&
      ws.current?.readyState === WebSocket.OPEN
    ) {
      ws.current.send(
        JSON.stringify({
          type: "requestEdit",
        })
      );
    }
  };

  if (error) {
    return <div className="error-message">{error}</div>;
  }

  if (!codeBlock) {
    return <div>Loading...</div>;
  }

  return (
    <div className="code-block-container">
      <div className="header-bar">
        <h1>{codeBlock?.title || "Code Block"}</h1>
        <button onClick={handleBackToLobby} className="back-to-lobby-btn">
          Back to Lobby
        </button>
      </div>
      <div className="status-bar">
        <div className="role-indicator">
          You are: {isConnected ? role : "connecting..."}
          {!isConnected && (
            <span className="connecting-message">
              {" "}
              (Connecting to server...)
            </span>
          )}
        </div>
        <div className="student-count">Students in room: {studentCount}</div>
        {role === "student" && (
          <div className="edit-status">
            {canEdit ? (
              <span className="can-edit-message">You can edit now</span>
            ) : (
              <button
                onClick={requestEdit}
                className="request-edit-btn"
                disabled={!isConnected}
              >
                Request to Edit
              </button>
            )}
          </div>
        )}
      </div>
      {role === "student" && (
        <div className="instruction-note">
          Note: Remove the comments and replace with your solution to see if it
          matches!
        </div>
      )}
      <div className="editor-container">
        <Editor
          value={codeBlock?.template || ""}
          onValueChange={handleCodeChange}
          highlight={(code) => highlight(code, languages.javascript)}
          padding={10}
          style={{
            fontFamily: '"Fira code", "Fira Mono", monospace',
            fontSize: 14,
            backgroundColor: "#f5f5f5",
            minHeight: "200px",
            borderRadius: "4px",
          }}
          readOnly={!canEdit}
          className={`code-editor ${!canEdit ? "readonly" : ""}`}
        />
      </div>
      {role === "mentor" && (
        <div className="solution-panel">
          <h3>Solution:</h3>
          <Editor
            value={codeBlock?.solution || ""}
            highlight={(code) => highlight(code, languages.javascript)}
            padding={10}
            style={{
              fontFamily: '"Fira code", "Fira Mono", monospace',
              fontSize: 14,
              backgroundColor: "#2d2d2d",
              color: "#fff",
              minHeight: "150px",
              borderRadius: "4px",
              marginTop: "20px",
            }}
            readOnly={true}
            className="solution-editor readonly"
          />
        </div>
      )}
      {isSolutionCorrect && (
        <div className="success-message">
          😊 Congratulations! You've found the correct solution! 😊
        </div>
      )}
    </div>
  );
};

export default CodeBlock;

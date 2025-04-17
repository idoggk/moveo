import React, { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import axios from "axios";
import Editor from "react-simple-code-editor";
import { highlight, languages } from "prismjs";
import "prismjs/components/prism-javascript";
import "prismjs/themes/prism.css";
import "prismjs/themes/prism-tomorrow.css";

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
  const { blockId } = useParams();
  const navigate = useNavigate();

  const handleBackToLobby = () => {
    if (ws.current) {
      if (role === "mentor") {
        console.log("Mentor leaving - sending notification to server");
        ws.current.send(
          JSON.stringify({
            type: "mentorLeaving",
            blockId: blockId,
          })
        );
      }
      // Close with code 1000 to indicate clean closure
      ws.current.close(1000, "User leaving");
      ws.current = null;
    }
    setCodeBlock(null);
    setStudentCount(0);
    setCanEdit(false);
    setIsConnected(false);
    navigate("/");
  };

  const connectWebSocket = () => {
    const clientId = sessionStorage.getItem("clientId");
    console.log("Attempting to connect WebSocket with client ID:", clientId);

    if (!clientId) {
      console.error("No client ID found in session storage");
      setError("Session expired. Please return to lobby.");
      setTimeout(() => navigate("/"), 2000);
      return;
    }

    // If we already have an open connection, don't create a new one
    if (ws.current?.readyState === WebSocket.OPEN) {
      console.log("WebSocket already connected and open");
      return;
    }

    // If we have a connection that's closing or in an intermediate state, wait for it
    if (ws.current && ws.current.readyState !== WebSocket.CLOSED) {
      console.log("WebSocket connection in progress, waiting...");
      return;
    }

    console.log("Connecting WebSocket...", { blockId, clientId });
    ws.current = new WebSocket(`ws://localhost:8000/ws/${blockId}/${clientId}`);

    ws.current.onopen = () => {
      console.log("WebSocket connected successfully");
      setIsConnected(true);
      setError("");
      reconnectAttempts.current = 0;
    };

    ws.current.onerror = (error) => {
      console.error("WebSocket error:", error);
      setError("Connection error. Attempting to reconnect...");
      setIsConnected(false);
    };

    ws.current.onclose = (event) => {
      console.log("WebSocket connection closed", event.code, event.reason);
      setIsConnected(false);

      // Don't reconnect if we're intentionally closing (code 1000)
      if (event.code === 1000) {
        console.log("Clean WebSocket closure, not reconnecting");
        return;
      }

      if (reconnectAttempts.current < maxReconnectAttempts) {
        console.log(
          `Connection closed. Reconnect attempt ${
            reconnectAttempts.current + 1
          } of ${maxReconnectAttempts}`
        );
        setTimeout(() => {
          reconnectAttempts.current += 1;
          connectWebSocket();
        }, 2000);
      } else {
        setError(
          "Connection lost. Please refresh the page or return to lobby."
        );
      }
    };

    ws.current.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log("Received WebSocket message:", data);

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
            console.log("Mentor left notification received");
            // Handle mentor leaving regardless of stored role
            // Clean up state
            setCodeBlock(null);
            setStudentCount(0);
            setCanEdit(false);
            setIsConnected(false);
            // Close WebSocket first with clean closure code
            if (ws.current) {
              ws.current.close(1000, "Mentor left");
              ws.current = null;
            }
            // Clear role and client ID from session storage
            sessionStorage.clear();
            // Navigate back to lobby and prevent going back
            navigate("/", { replace: true });
            break;
          case "editorChange":
            setCanEdit(role === "student" && data.canEdit);
            break;
          default:
            console.log("Unknown message type:", data.type);
        }
      } catch (err) {
        console.error("Error parsing WebSocket message:", err);
      }
    };
  };

  useEffect(() => {
    let isActive = true; // Flag to prevent operations after unmount

    const fetchCodeBlock = async () => {
      try {
        const response = await axios.get(
          `http://localhost:8000/code-blocks/${blockId}`
        );
        if (response.data) {
          setCodeBlock(response.data);
        }
      } catch (err) {
        console.error("Failed to load code block:", err);
        setError("Failed to load code block. Please try again later.");
      }
    };

    const verifyRole = async () => {
      const clientId = sessionStorage.getItem("clientId");
      const storedRole = sessionStorage.getItem("userRole");

      console.log("Verifying role with stored values:", {
        clientId,
        storedRole,
      });

      if (!clientId) {
        console.error("No client ID found");
        setError("Session expired. Please return to lobby.");
        setTimeout(() => navigate("/"), 2000);
        return false;
      }

      try {
        const response = await fetch(
          `http://localhost:8000/my-role/${clientId}`
        );
        if (!response.ok) {
          throw new Error("Failed to verify role");
        }
        const data = await response.json();

        // Always update role from server
        console.log("Setting role from server:", data.role);
        sessionStorage.setItem("userRole", data.role);
        setRole(data.role);
        return true;
      } catch (err) {
        console.error("Error verifying role:", err);
        setError("Failed to verify role. Please return to lobby.");
        setTimeout(() => navigate("/"), 2000);
        return false;
      }
    };

    const init = async () => {
      if (!isActive) return;

      const isRoleValid = await verifyRole();
      if (!isActive) return;

      if (isRoleValid) {
        await fetchCodeBlock();
        if (!isActive) return;

        // Only connect WebSocket if we don't have an active connection
        if (!ws.current || ws.current.readyState === WebSocket.CLOSED) {
          connectWebSocket();
        }
      }
    };

    init();

    // Cleanup function
    return () => {
      isActive = false;
      console.log("Component unmounting - cleaning up");
      if (ws.current) {
        console.log("Closing WebSocket connection");
        ws.current.close(1000, "Component unmounting");
        ws.current = null;
      }
      // Clear any reconnection timeouts
      reconnectAttempts.current = maxReconnectAttempts;
    };
  }, [blockId, navigate]);

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
      console.log("Requesting edit permission");
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
      {isSolutionCorrect && (
        <div className="success-message">
          🎉 Congratulations! You've found the correct solution! 🎉
        </div>
      )}
    </div>
  );
};

export default CodeBlock;

import React, { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import axios from "axios";
import Editor from "react-simple-code-editor";
import { highlight, languages } from "prismjs";
import "prismjs/components/prism-javascript";
import "prismjs/themes/prism.css";

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

  const connectWebSocket = () => {
    const clientId = sessionStorage.getItem("clientId");
    if (!clientId) {
      console.error("No client ID found");
      navigate("/");
      return;
    }

    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      console.log("WebSocket already connected");
      return;
    }

    console.log("Connecting WebSocket...", { blockId, clientId });
    ws.current = new WebSocket(`ws://localhost:8000/ws/${blockId}/${clientId}`);

    ws.current.onopen = () => {
      console.log("WebSocket connected successfully");
      setIsConnected(true);
      reconnectAttempts.current = 0;
    };

    ws.current.onclose = (event) => {
      console.log("WebSocket disconnected", event);
      setIsConnected(false);

      // Only attempt to reconnect if we haven't exceeded max attempts
      if (reconnectAttempts.current < maxReconnectAttempts) {
        console.log(`Reconnecting... Attempt ${reconnectAttempts.current + 1}`);
        reconnectAttempts.current++;
        setTimeout(connectWebSocket, 1000);
      } else if (role === "student") {
        navigate("/");
      }
    };

    ws.current.onerror = (error) => {
      console.error("WebSocket error:", error);
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
            setCanEdit(data.canEdit);
            break;
          case "mentorLeft":
            if (role === "student") {
              navigate("/");
            }
            break;
          case "editorChange":
            setCanEdit(data.canEdit);
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
    let mounted = true;

    const fetchCodeBlock = async () => {
      try {
        const response = await axios.get(
          `http://localhost:8000/code-blocks/${blockId}`
        );
        if (mounted) {
          setCodeBlock(response.data);
        }
      } catch (err) {
        if (mounted) {
          console.error("Failed to load code block:", err);
          setError("Failed to load code block. Please try again later.");
        }
      }
    };

    console.log("CodeBlock component mounted", {
      blockId,
      role: sessionStorage.getItem("userRole"),
    });

    fetchCodeBlock();
    connectWebSocket();

    return () => {
      mounted = false;
      if (ws.current) {
        ws.current.close();
      }
    };
  }, [blockId, navigate, role]);

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

    if (newCode === codeBlock?.solution) {
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
      <h1>{codeBlock.title}</h1>
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
        {role === "student" && !canEdit && (
          <button onClick={requestEdit} className="request-edit-btn">
            Request to Edit
          </button>
        )}
      </div>
      <div className="editor-container">
        <Editor
          value={codeBlock.template}
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

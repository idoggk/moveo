import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';

const CodeBlock = () => {
  const [codeBlock, setCodeBlock] = useState(null);
  const [error, setError] = useState('');
  const [role, setRole] = useState('');
  const [studentCount, setStudentCount] = useState(0);
  const [isSolutionCorrect, setIsSolutionCorrect] = useState(false);
  const ws = useRef(null);
  const { blockId } = useParams();
  const navigate = useNavigate();

  useEffect(() => {
    const fetchCodeBlock = async () => {
      try {
        const response = await axios.get(`http://localhost:8000/code-blocks/${blockId}`);
        setCodeBlock(response.data);
      } catch (err) {
        setError('Failed to load code block. Please try again later.');
      }
    };

    fetchCodeBlock();

    // Initialize WebSocket connection
    ws.current = new WebSocket(`ws://localhost:8000/ws/${blockId}`);

    ws.current.onopen = () => {
      console.log('WebSocket connected');
    };

    ws.current.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'codeUpdate') {
          setCodeBlock(prev => ({ ...prev, template: data.code }));
        } else if (data.type === 'role') {
          setRole(data.role);
          setStudentCount(data.studentCount || 0);
        }
      } catch (err) {
        console.error('Error parsing WebSocket message:', err);
      }
    };

    ws.current.onclose = () => {
      if (role === 'mentor') {
        navigate('/');
      }
    };

    return () => {
      if (ws.current) {
        ws.current.close();
      }
    };
  }, [blockId, navigate, role]);

  const handleCodeChange = (e) => {
    if (role === 'student') {
      const newCode = e.target.value;
      setCodeBlock(prev => ({ ...prev, template: newCode }));
      
      // Send code update to server
      if (ws.current && ws.current.readyState === WebSocket.OPEN) {
        ws.current.send(JSON.stringify({
          type: 'codeUpdate',
          code: newCode
        }));
      }

      // Check if solution is correct
      if (newCode === codeBlock.solution) {
        setIsSolutionCorrect(true);
      } else {
        setIsSolutionCorrect(false);
      }
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
      <div className="role-indicator">
        You are: {role || 'connecting...'}
      </div>
      <div className="student-count">
        Students in room: {studentCount}
      </div>
      <textarea
        className="code-editor"
        value={codeBlock.template}
        onChange={handleCodeChange}
        readOnly={role === 'mentor' || !role}
        placeholder={!role ? "Connecting..." : role === 'mentor' ? "Read-only mode" : "Start coding!"}
      />
      {isSolutionCorrect && (
        <div className="success-message">
          🎉 Congratulations! You've found the correct solution! 🎉
        </div>
      )}
    </div>
  );
};

export default CodeBlock; 
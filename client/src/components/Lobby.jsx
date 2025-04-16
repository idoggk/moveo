import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';

const Lobby = () => {
  const [codeBlocks, setCodeBlocks] = useState([]);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    const fetchCodeBlocks = async () => {
      try {
        const response = await axios.get('http://localhost:8000/code-blocks');
        setCodeBlocks(response.data.code_blocks);
      } catch (err) {
        setError('Failed to load code blocks. Please try again later.');
      }
    };

    fetchCodeBlocks();
  }, []);

  const handleCodeBlockClick = (blockId) => {
    navigate(`/code-block/${blockId}`);
  };

  if (error) {
    return <div className="error-message">{error}</div>;
  }

  return (
    <div className="lobby-container">
      <h1>Choose code block</h1>
      <div className="code-blocks-list">
        {codeBlocks.map((block) => (
          <div
            key={block.id}
            className="code-block-item"
            onClick={() => handleCodeBlockClick(block.id)}
          >
            {block.title}
          </div>
        ))}
      </div>
    </div>
  );
};

export default Lobby; 
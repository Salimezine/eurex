import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import AccessGate, { isAuthorized } from './AccessGate';
import App from './App';
import './index.css';

const root = ReactDOM.createRoot(document.getElementById('root')!);

function render() {
  const authorized = isAuthorized();
  root.render(
    <React.StrictMode>
      <BrowserRouter basename="/eurex">
        {authorized ? <App /> : <AccessGate onAuthorized={render} />}
      </BrowserRouter>
    </React.StrictMode>
  );
}

render();

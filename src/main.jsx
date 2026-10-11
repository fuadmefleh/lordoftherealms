import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './App.css';
import { applyUiScale } from './ui/uiScale';

// Size the interface for this screen before the first paint
applyUiScale();

ReactDOM.createRoot(document.getElementById('root')).render(
    <App />
);

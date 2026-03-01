import React from 'react';

export default function LoadingOverlay() {
  return (
    <div id="loadingOverlay">
      <div id="loadingContent">
        <div className="loading-spinner"></div>
        <p id="loadingText">Generating World...</p>
        <p id="loadingSubtext">Forging continents and oceans</p>
      </div>
    </div>
  );
}

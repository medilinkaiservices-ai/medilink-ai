import React, { useState } from "react";

function QuickActions({ isOwner, setIsOwner }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button className="shop-quick-toggle" onClick={() => setOpen((value) => !value)}>
        Workspace
      </button>

      <aside className={`shop-quick-panel ${open ? "open" : ""}`}>
        <div className="shop-quick-panel-card">
          <div className="eyebrow">Seller controls</div>
          <h3>Shop workspace</h3>
          <p className="muted-copy">
            Switch between customer browsing and owner controls without leaving the page.
          </p>
          <div className="seller-inline-actions">
            <button className="primary-button" onClick={() => setIsOwner(!isOwner)}>
              {isOwner ? "Customer mode" : "Owner mode"}
            </button>
            <button className="ghost-button" onClick={() => (window.location.href = "/seller-orders")}>
              Seller orders
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}

export default QuickActions;

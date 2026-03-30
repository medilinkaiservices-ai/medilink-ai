import React from "react";

function IntegrationGuide({ role = "business" }) {
  const roleLabel =
    role === "seller" ? "shop" : role === "hospital" ? "hospital" : "customer profile";

  const examples =
    role === "seller"
      ? "Products, stock, price, barcode, and catalog images"
      : role === "hospital"
        ? "Appointments, departments, doctors, and patient-facing schedules"
        : "Personal app data, health profile links, or connected service records";

  return (
    <div className="soft-panel">
      <div className="section-title">Integration user guide</div>
      <div className="integration-guide-list">
        <div className="list-row">
          <span>1. Choose software type</span>
          <small>Select website, app, ERP, POS, HMS, or custom software</small>
        </div>
        <div className="list-row">
          <span>2. Enter connection details</span>
          <small>Add website URL, API base URL, webhook URL, and database type if available</small>
        </div>
        <div className="list-row">
          <span>3. Select sync method</span>
          <small>Use API, webhook, database bridge, CSV import, or manual sync</small>
        </div>
        <div className="list-row">
          <span>4. Save and test</span>
          <small>Click Save Integration, then Test Connection to confirm reachability</small>
        </div>
        <div className="list-row">
          <span>5. Enable sync and run</span>
          <small>Turn on integration and run sync request to import data into the {roleLabel}</small>
        </div>
      </div>
      <p className="muted-copy" style={{ marginTop: "14px" }}>
        Typical sync data: {examples}
      </p>
      <p className="muted-copy">
        If your external system exposes JSON, prefer endpoints like `/products` or `/appointments`.
      </p>
    </div>
  );
}

export default IntegrationGuide;

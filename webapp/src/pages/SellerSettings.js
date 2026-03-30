import React, { useState } from "react";
import { Navigate } from "react-router-dom";
import { doc, updateDoc } from "firebase/firestore";
import SellerShell from "../components/SellerShell";
import IntegrationGuide from "../components/IntegrationGuide";
import { db } from "../firebase";
import { getStoredProfile, saveStoredProfile } from "../utils/session";
import {
  runIntegrationSync,
  saveIntegrationConfig,
  testIntegrationConnection
} from "../utils/integrationApi";
import {
  CONNECTION_METHODS,
  CONNECTOR_TYPES,
  DATABASE_PROVIDERS,
  SYNC_DIRECTIONS,
  createDefaultIntegrationConfig
} from "../utils/integrationConfig";

function SellerSettings() {
  const initialProfile = getStoredProfile("seller");
  const [saving, setSaving] = useState(false);
  const [integrationBusy, setIntegrationBusy] = useState(false);
  const [integrationStatus, setIntegrationStatus] = useState("");
  const [form, setForm] = useState({
    whatsappPhone: initialProfile?.whatsappPhone || initialProfile?.phone || "",
    openTime: initialProfile?.openTime || "08:00",
    closeTime: initialProfile?.closeTime || "21:00",
    deliveryRadius: initialProfile?.deliveryRadius || "5",
    orderEnabled:
      initialProfile?.orderEnabled === undefined ? true : Boolean(initialProfile.orderEnabled),
    holidayMode: Boolean(initialProfile?.holidayMode),
    integrationConfig: createDefaultIntegrationConfig(initialProfile?.integrationConfig)
  });

  if (!initialProfile) {
    return <Navigate to="/register/seller" replace />;
  }

  const handleChange = (event) => {
    const { name, value, type, checked } = event.target;

    setForm((current) => ({
      ...current,
      [name]:
        type === "checkbox"
          ? checked
          : name === "whatsappPhone"
            ? value.replace(/[^0-9]/g, "").slice(0, 10)
            : value
    }));
  };

  const handleIntegrationChange = (event) => {
    const { name, value, type, checked } = event.target;
    setForm((current) => ({
      ...current,
      integrationConfig: {
        ...current.integrationConfig,
        [name]: type === "checkbox" ? checked : value
      }
    }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    try {
      setSaving(true);

      const nextProfile = {
        ...initialProfile,
        ...form
      };

      await updateDoc(doc(db, "sellers", initialProfile.shopId), {
        whatsappPhone: nextProfile.whatsappPhone,
        openTime: nextProfile.openTime,
        closeTime: nextProfile.closeTime,
        deliveryRadius: Number(nextProfile.deliveryRadius || 0),
        orderEnabled: nextProfile.orderEnabled,
        holidayMode: nextProfile.holidayMode,
        integrationConfig: nextProfile.integrationConfig
      });

      saveStoredProfile("seller", nextProfile);
      alert("Seller settings saved.");
    } catch (error) {
      console.error("Failed to save seller settings:", error);
      alert("Could not save seller settings.");
    } finally {
      setSaving(false);
    }
  };

  const integrationPayload = {
    role: "seller",
    entityId: initialProfile.shopId,
    profileName: initialProfile.shopName || initialProfile.name || "Seller",
    integrationConfig: form.integrationConfig
  };

  const handleIntegrationAction = async (action) => {
    try {
      setIntegrationBusy(true);
      let response;

      if (action === "save") {
        response = await saveIntegrationConfig(integrationPayload);
      } else if (action === "test") {
        response = await testIntegrationConnection(integrationPayload);
      } else {
        response = await runIntegrationSync(integrationPayload);
      }

      setIntegrationStatus(response.message || "Integration request completed.");
    } catch (error) {
      console.error(`Seller integration ${action} failed:`, error);
      setIntegrationStatus("Integration request failed.");
    } finally {
      setIntegrationBusy(false);
    }
  };

  return (
    <SellerShell
      title="Seller settings"
      subtitle="Control shop timings, order availability and WhatsApp order preferences."
    >
      <div className="seller-two-column">
        <form className="auth-card" onSubmit={handleSubmit}>
          <label>
            WhatsApp order number
            <input
              name="whatsappPhone"
              value={form.whatsappPhone}
              onChange={handleChange}
              placeholder="10 digit WhatsApp number"
            />
          </label>

          <div className="seller-form-grid">
            <label>
              Open time
              <input
                name="openTime"
                type="time"
                value={form.openTime}
                onChange={handleChange}
              />
            </label>
            <label>
              Close time
              <input
                name="closeTime"
                type="time"
                value={form.closeTime}
                onChange={handleChange}
              />
            </label>
            <label>
              Delivery radius (km)
              <input
                name="deliveryRadius"
                type="number"
                value={form.deliveryRadius}
                onChange={handleChange}
              />
            </label>
          </div>

          <label className="seller-check-row">
            <input
              name="orderEnabled"
              type="checkbox"
              checked={form.orderEnabled}
              onChange={handleChange}
            />
            Accept orders from customers
          </label>

          <label className="seller-check-row">
            <input
              name="holidayMode"
              type="checkbox"
              checked={form.holidayMode}
              onChange={handleChange}
            />
            Holiday mode
          </label>

          <button type="submit" className="primary-button" disabled={saving}>
            {saving ? "Saving..." : "Save settings"}
          </button>

          <div className="soft-panel" style={{ marginTop: "6px" }}>
            <div className="section-title">Integration hub</div>
            <p className="muted-copy" style={{ marginBottom: "14px" }}>
              Connect your existing website, POS, ERP, or database to Medilink AI through API, webhook, CSV, or database bridge options.
            </p>

            <div className="seller-form-grid">
              <label>
                Software / website name
                <input
                  name="softwareName"
                  value={form.integrationConfig.softwareName}
                  onChange={handleIntegrationChange}
                  placeholder="Shopify / GoFrugal / custom site"
                />
              </label>
              <label>
                Connector type
                <select name="connectorType" value={form.integrationConfig.connectorType} onChange={handleIntegrationChange}>
                  {CONNECTOR_TYPES.map((item) => (
                    <option key={item} value={item}>{item}</option>
                  ))}
                </select>
              </label>
              <label>
                Website URL
                <input
                  name="websiteUrl"
                  value={form.integrationConfig.websiteUrl}
                  onChange={handleIntegrationChange}
                  placeholder="https://yourshop.com"
                />
              </label>
              <label>
                API base URL
                <input
                  name="apiBaseUrl"
                  value={form.integrationConfig.apiBaseUrl}
                  onChange={handleIntegrationChange}
                  placeholder="https://api.yourshop.com"
                />
              </label>
              <label>
                Webhook URL
                <input
                  name="webhookUrl"
                  value={form.integrationConfig.webhookUrl}
                  onChange={handleIntegrationChange}
                  placeholder="https://yourshop.com/webhooks/medilink"
                />
              </label>
              <label>
                Connection method
                <select name="connectionMethod" value={form.integrationConfig.connectionMethod} onChange={handleIntegrationChange}>
                  {CONNECTION_METHODS.map((item) => (
                    <option key={item} value={item}>{item}</option>
                  ))}
                </select>
              </label>
              <label>
                Database provider
                <select name="databaseProvider" value={form.integrationConfig.databaseProvider} onChange={handleIntegrationChange}>
                  {DATABASE_PROVIDERS.map((item) => (
                    <option key={item} value={item}>{item}</option>
                  ))}
                </select>
              </label>
              <label>
                Database / schema name
                <input
                  name="databaseName"
                  value={form.integrationConfig.databaseName}
                  onChange={handleIntegrationChange}
                  placeholder="shop_catalog"
                />
              </label>
              <label>
                Sync direction
                <select name="syncDirection" value={form.integrationConfig.syncDirection} onChange={handleIntegrationChange}>
                  {SYNC_DIRECTIONS.map((item) => (
                    <option key={item} value={item}>{item}</option>
                  ))}
                </select>
              </label>
              <label>
                Access key label
                <input
                  name="accessKeyLabel"
                  value={form.integrationConfig.accessKeyLabel}
                  onChange={handleIntegrationChange}
                  placeholder="medilink-prod-key"
                />
              </label>
            </div>

            <label style={{ marginTop: "12px", display: "grid", gap: "8px", color: "#334155", fontWeight: 600 }}>
              Integration notes
              <textarea
                name="integrationNotes"
                rows="3"
                value={form.integrationConfig.integrationNotes}
                onChange={handleIntegrationChange}
                placeholder="Products, inventory, appointments, or orders to sync"
              />
            </label>

            <label className="seller-check-row" style={{ marginTop: "12px" }}>
              <input
                name="syncEnabled"
                type="checkbox"
                checked={form.integrationConfig.syncEnabled}
                onChange={handleIntegrationChange}
              />
              Enable Medilink integration for this shop
            </label>

            {integrationStatus ? <div className="muted-copy" style={{ marginTop: "10px" }}>{integrationStatus}</div> : null}
            <div className="seller-inline-actions" style={{ marginTop: "12px" }}>
              <button type="button" className="ghost-button" disabled={integrationBusy} onClick={() => handleIntegrationAction("save")}>
                {integrationBusy ? "Working..." : "Save Integration"}
              </button>
              <button type="button" className="ghost-button" disabled={integrationBusy} onClick={() => handleIntegrationAction("test")}>
                Test Connection
              </button>
              <button type="button" className="primary-button" disabled={integrationBusy} onClick={() => handleIntegrationAction("sync")}>
                Run Sync Request
              </button>
            </div>
          </div>
        </form>

        <div className="seller-profile-preview">
          <IntegrationGuide role="seller" />
          <div className="soft-panel">
            <div className="section-title">Current shop operations</div>
            <p className="muted-copy">
              WhatsApp: {form.whatsappPhone || "Not set"}
            </p>
            <p className="muted-copy">
              Timings: {form.openTime} to {form.closeTime}
            </p>
            <p className="muted-copy">
              Delivery radius: {form.deliveryRadius} km
            </p>
            <p className="muted-copy">
              Orders: {form.orderEnabled ? "Enabled" : "Paused"}
            </p>
            <p className="muted-copy">
              Holiday mode: {form.holidayMode ? "On" : "Off"}
            </p>
          </div>

          <div className="soft-panel">
            <div className="section-title">External connection status</div>
            <p className="muted-copy">
              Software: {form.integrationConfig.softwareName || "Not connected"}
            </p>
            <p className="muted-copy">
              Method: {form.integrationConfig.connectionMethod} | Sync: {form.integrationConfig.syncDirection}
            </p>
            <p className="muted-copy">
              Database: {form.integrationConfig.databaseProvider} {form.integrationConfig.databaseName ? `| ${form.integrationConfig.databaseName}` : ""}
            </p>
            <p className="muted-copy">
              Status: {form.integrationConfig.syncEnabled ? "Integration enabled" : "Integration not enabled"}
            </p>
          </div>
        </div>
      </div>
    </SellerShell>
  );
}

export default SellerSettings;

import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import Chatbot from "../components/Chatbot";
import WorkspaceMenu from "../components/WorkspaceMenu";

function MarketplaceHome() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const handleSearchSubmit = (event) => {
    event.preventDefault();
    const keyword = search.trim();
    if (!keyword) return;
    navigate(`/search?q=${encodeURIComponent(keyword)}`);
  };

  const landingChatContext = {
    appFeatures: "Search shops, services, medicines and hospitals from one landing page.",
    navigationHelp: "Use search in the center or open the menu to jump into customer, seller, hospital or chat spaces.",
    generalInfo: "Medilink AI combines marketplace discovery and role-based workspaces."
  };

  return (
    <div className="search-home-shell">
      <WorkspaceMenu />
      <button type="button" className="mobile-workspace-toggle" onClick={() => setIsMobileMenuOpen(true)}>
        Menu
      </button>

      {isMobileMenuOpen ? (
        <div className="mobile-workspace-overlay" onClick={() => setIsMobileMenuOpen(false)}>
          <div onClick={(event) => event.stopPropagation()}>
            <WorkspaceMenu
              className="mobile-workspace-menu"
              onNavigate={() => setIsMobileMenuOpen(false)}
              onClose={() => setIsMobileMenuOpen(false)}
              showClose
            />
          </div>
        </div>
      ) : null}

      <main className="search-home-main">
        <section className="search-home-center">
          <div className="search-home-mark">Medilink AI</div>
          <h1 className="search-home-title">Search shops, services and hospitals.</h1>
          <p className="search-home-copy">
            One clean search surface for shops, services, hospitals, medicines and workspace discovery.
          </p>

          <form className="search-home-form" onSubmit={handleSearchSubmit}>
            <input
              className="search-home-input"
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search shops, services, medicines, diagnostics, hospitals..."
            />
            <button type="submit" className="search-home-button">
              Search
            </button>
          </form>
        </section>
      </main>

      <Chatbot role="customer" contextData={landingChatContext} floating />
    </div>
  );
}

export default MarketplaceHome;

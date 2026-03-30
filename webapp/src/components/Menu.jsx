import React from "react";
import { useNavigate } from "react-router-dom";

function Menu({ closeMenu }) {

  const navigate = useNavigate();

  const go = (path) => {
    navigate(path);
    closeMenu(); // menu close
  };

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "250px",
        height: "100%",
        background: "#0b1d35",
        color: "white",
        padding: "20px",
        zIndex: 999
      }}
    >

      <h3>Menu</h3>

      <button onClick={() => go("/")}>Home</button><br/><br/>

      <button onClick={() => go("/product-entry")}>
        Product Entry
      </button><br/><br/>

      <button onClick={() => go("/product-update")}>
        Product Update
      </button>

    </div>
  );
}

export default Menu;
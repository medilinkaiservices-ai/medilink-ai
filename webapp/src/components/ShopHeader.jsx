import React, { useState, useEffect } from "react";
import { db, storage } from "../firebase";
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";

function ShopHeader({ shopId, isOwner }) {

  const [shop, setShop] = useState(null);

  useEffect(() => {

    const loadShop = async () => {

      if (!shopId) return;

      const refDoc = doc(db, "sellers", shopId);
      const snap = await getDoc(refDoc);

      if (snap.exists()) {
        setShop(snap.data());
      }

    };

    loadShop();

  }, [shopId]);


  /* COVER IMAGE UPLOAD */
  const uploadCover = async (e) => {

    const file = e.target.files[0];
    if (!file) return;

    const storageRef = ref(storage, `shopCovers/${shopId}`);

    await uploadBytes(storageRef, file);

    const url = await getDownloadURL(storageRef);

    await updateDoc(doc(db, "sellers", shopId), {
      coverImage: url
    });

    setShop(prev => ({
      ...prev,
      coverImage: url
    }));

  };


  /* LOGO UPLOAD */
  const uploadLogo = async (e) => {

    const file = e.target.files[0];
    if (!file) return;

    const storageRef = ref(storage, `shopLogos/${shopId}`);

    await uploadBytes(storageRef, file);

    const url = await getDownloadURL(storageRef);

    await updateDoc(doc(db, "sellers", shopId), {
      logo: url
    });

    setShop(prev => ({
      ...prev,
      logo: url
    }));

  };


  if (!shop) return <div>Loading...</div>;

  return (

    <div style={{ background: "#fff", borderRadius: "10px", overflow: "hidden" }}>

      {/* COVER IMAGE */}
      <div
        style={{
          height: "420px",
          position: "relative",
          overflow: "hidden",
          background: "#eee"
        }}
      >

        <img
          src={shop.coverImage || "/default-cover.jpg"}
          alt="cover"
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover"
          }}
        />

        {isOwner && (
          <label
            style={{
              position: "absolute",
              right: "15px",
              bottom: "15px",
              background: "#000",
              color: "#fff",
              padding: "6px 12px",
              borderRadius: "6px",
              cursor: "pointer"
            }}
          >
            Edit Cover
            <input type="file" onChange={uploadCover} hidden />
          </label>
        )}

      </div>


      {/* PROFILE */}
      <div style={{ textAlign: "center", marginTop: "-60px" }}>

        <div style={{ position: "relative", display: "inline-block" }}>

          <img
            src={shop.logo || "/default-logo.png"}
            alt="logo"
            style={{
              width: "140px",
              height: "140px",
              borderRadius: "50%",
              border: "6px solid white",
              objectFit: "cover",
              background: "#fff"
            }}
          />

          {isOwner && (
            <label
              style={{
                position: "absolute",
                bottom: "0",
                right: "0",
                background: "#000",
                color: "#fff",
                borderRadius: "50%",
                padding: "6px",
                cursor: "pointer",
                fontSize: "12px"
              }}
            >
              ✏
              <input type="file" onChange={uploadLogo} hidden />
            </label>
          )}

        </div>

        <h2 style={{ marginTop: "10px" }}>
          {shop.shopName || "Shop Name"}
        </h2>

        {shop.ownerName && <p>Owner: {shop.ownerName}</p>}
        {shop.location && <p>📍 {shop.location}</p>}

      </div>

    </div>

  );
}

export default ShopHeader;
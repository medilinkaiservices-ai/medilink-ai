import React, { useEffect, useState } from "react";
import { useLocation, Link } from "react-router-dom";
import { db } from "../firebase";
import { collection, getDocs } from "firebase/firestore";
import { fetchHospitals } from "../utils/hospitalApi";

function SearchPage() {

  const location = useLocation();
  const query = new URLSearchParams(location.search).get("q");

  const [results,setResults] = useState([]);
  const [error, setError] = useState("");

  useEffect(()=>{

    const loadSearch = async()=>{
      try {
        setError("");

        const productSnap = await getDocs(collection(db,"products"));
        const shopSnap = await getDocs(collection(db,"sellers"));

        const products = productSnap.docs.map(doc=>({
          id:doc.id,
          ...doc.data()
        }));

        const shops = shopSnap.docs.map(doc=>({
          id:doc.id,
          ...doc.data()
        }));

        const keyword = query?.toLowerCase() || "";
        const hospitals = await fetchHospitals();

        const productResults = products
        .filter(p=>p.productName?.toLowerCase().includes(keyword))
        .map(p=>{

          const shop = shops.find(s=>s.id === p.shopId);

          return {
            type:"product",
            productName:p.productName,
            price:p.price,
            discount:p.discount || 0,
            shopName:shop?.shopName,
            area:shop?.area,
            distance:shop?.distance,
            shopId:p.shopId
          }

        });

        const shopResults = shops
        .filter(s=>s.shopName?.toLowerCase().includes(keyword))
        .map(s=>({
          type:"shop",
          shopName:s.shopName,
          area:s.area,
          distance:s.distance,
          shopId:s.id
        }));

        const hospitalResults = hospitals
        .filter(h=>h.hospitalName?.toLowerCase().includes(keyword) || (h.city || "").toLowerCase().includes(keyword))
        .map(h=>({
          type:"hospital",
          hospitalName:h.hospitalName,
          city:h.city,
          hospitalId:h.id
        }));

        setResults([...productResults,...shopResults,...hospitalResults]);
      } catch (error) {
        console.error("Search load failed:", error);
        setResults([]);
        setError("Search data is not accessible right now. Firestore permissions need update.");
      }

    };

    loadSearch();

  },[query]);

  return(

    <div style={{padding:"40px",maxWidth:"900px",margin:"auto"}}>

      <h2>Search results for "{query}"</h2>

      {error && (
        <div className="soft-panel" style={{ marginTop: "20px", marginBottom: "20px" }}>
          <p className="muted-copy">{error}</p>
        </div>
      )}

      {!error && results.length === 0 && (
        <div className="soft-panel" style={{ marginTop: "20px", marginBottom: "20px" }}>
          <p className="muted-copy">No results found.</p>
        </div>
      )}

      {results.map((r,index)=>{

        if(r.type === "product"){

          return(

            <div key={index} style={{marginBottom:"25px"}}>

              <Link
              to={`/shop/${r.shopId}`}
              style={{
                fontSize:"22px",
                color:"#1a0dab",
                textDecoration:"none"
              }}>
                {r.productName}
              </Link>

              <div style={{color:"green"}}>
                medilink.ai/shop/{r.shopId}
              </div>

              <div style={{color:"#444"}}>
                {r.shopName} • ₹{r.price}
                {r.discount ? ` • ${r.discount}% OFF` : ""}
                {r.distance ? ` • ${r.distance} km away` : ""}
              </div>

            </div>

          )

        }

        if(r.type === "hospital"){

          return(

            <div key={index} style={{marginBottom:"25px"}}>

              <Link
              to={`/hospitals/${encodeURIComponent(r.hospitalId)}`}
              style={{
                fontSize:"22px",
                color:"#1a0dab",
                textDecoration:"none"
              }}>
                {r.hospitalName}
              </Link>

              <div style={{color:"green"}}>
                medilink.ai/hospitals/{r.hospitalId}
              </div>

              <div>
                Hospital profile
                {r.city ? ` • ${r.city}` : ""}
              </div>

            </div>

          )

        }

        return(

          <div key={index} style={{marginBottom:"25px"}}>

            <Link
            to={`/shop/${r.shopId}`}
            style={{
              fontSize:"22px",
              color:"#1a0dab",
              textDecoration:"none"
            }}>
              {r.shopName}
            </Link>

            <div style={{color:"green"}}>
              medilink.ai/shop/{r.shopId}
            </div>

            <div>
              Local medical / kirana shop
              {r.area ? ` • ${r.area}` : ""}
            </div>

          </div>

        )

      })}

    </div>

  )

}

export default SearchPage;

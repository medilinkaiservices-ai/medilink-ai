import React, { useEffect, useState } from "react";
import { db } from "./firebase";
import { collection, onSnapshot } from "firebase/firestore";
import { useNavigate } from "react-router-dom";

function TrendingProducts() {

  const navigate = useNavigate();

  const [sales, setSales] = useState([]);
  const [products, setProducts] = useState([]);

  /* 🔥 LOAD SALES */
  useEffect(() => {

    const unsub = onSnapshot(
      collection(db, "affiliateSales"),
      (snapshot) => {

        setSales(
          snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
          }))
        );

      }
    );

    return () => unsub();

  }, []);


  /* 🔥 LOAD PRODUCTS */
  useEffect(() => {

    const unsub = onSnapshot(
      collection(db, "products"),
      (snapshot) => {

        setProducts(
          snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
          }))
        );

      }
    );

    return () => unsub();

  }, []);


  /* 🔥 COUNT SALES PER PRODUCT */
  const productSales = {};

  sales.forEach(sale => {

    if (!productSales[sale.productId]) {
      productSales[sale.productId] = 0;
    }

    productSales[sale.productId]++;

  });


  /* 🔥 SORT TRENDING */
  const trending = Object.entries(productSales)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);


  return (

    <div style={{ padding: "40px" }}>

      <h2>🔥 Trending Products</h2>

      {trending.map(([productId, count]) => {

        const product = products.find(p => p.id === productId);

        if (!product) return null;

        return (

          <div
            key={productId}
            style={{
              border: "1px solid #ddd",
              padding: "15px",
              marginTop: "10px",
              cursor: "pointer"
            }}
            onClick={() => navigate(`/shop/${product.shopId}`)}
          >

            <h3>{product.productName}</h3>

            <p>🔥 {count} Sales</p>

          </div>

        );

      })}

    </div>

  );
}

export default TrendingProducts;
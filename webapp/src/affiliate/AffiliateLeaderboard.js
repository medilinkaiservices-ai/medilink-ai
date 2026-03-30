import React, { useEffect, useState } from "react";
import { db } from "../firebase";
import { collection, onSnapshot } from "firebase/firestore";

function AffiliateLeaderboard() {

  const [leaders, setLeaders] = useState([]);

  useEffect(() => {

    const unsubscribe = onSnapshot(
      collection(db, "affiliateSales"),
      (snapshot) => {

        const sales = snapshot.docs.map(doc => doc.data());

        // Group earnings by refUser
        const earningsMap = {};

        sales.forEach((sale) => {

          if (!earningsMap[sale.refUser]) {
            earningsMap[sale.refUser] = 0;
          }

          earningsMap[sale.refUser] += sale.commission || 0;

        });

        // Convert to array
        const leaderboard = Object.keys(earningsMap).map(user => ({
          user,
          earnings: earningsMap[user]
        }));

        // Sort highest earnings first
        leaderboard.sort((a, b) => b.earnings - a.earnings);

        setLeaders(leaderboard);

      }
    );

    return () => unsubscribe();

  }, []);

  return (
    <div style={{ padding: "30px" }}>

      <h2>🏆 Top Affiliates</h2>

      <table
        style={{
          width: "600px",
          borderCollapse: "collapse",
          marginTop: "20px"
        }}
      >

        <thead>
          <tr>
            <th style={{border:"1px solid #ccc", padding:"8px"}}>Rank</th>
            <th style={{border:"1px solid #ccc", padding:"8px"}}>User</th>
            <th style={{border:"1px solid #ccc", padding:"8px"}}>Total Earnings</th>
          </tr>
        </thead>

        <tbody>

          {leaders.map((leader, index) => (
            <tr key={index}>

              <td style={{border:"1px solid #ccc", padding:"8px"}}>
                #{index + 1}
              </td>

              <td style={{border:"1px solid #ccc", padding:"8px"}}>
                {leader.user}
              </td>

              <td style={{border:"1px solid #ccc", padding:"8px"}}>
                ₹{leader.earnings}
              </td>

            </tr>
          ))}

        </tbody>

      </table>

    </div>
  );
}

export default AffiliateLeaderboard;
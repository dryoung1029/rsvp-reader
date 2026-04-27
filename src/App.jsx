import React, { useState } from "react";

export default function App() {
  const [text, setText] = useState("");

  async function loadFromURL(url) {
    const res = await fetch("/api/extract", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({ url })
    });
    const data = await res.json();
    setText(data.text);
  }

  return (
    <div style={{padding:20}}>
      <h1>RSVP Reader</h1>

      <input
        placeholder="Paste URL and press Enter"
        style={{width:"100%", padding:10}}
        onKeyDown={(e)=>{
          if(e.key==="Enter") loadFromURL(e.target.value)
        }}
      />

      <textarea
        value={text}
        onChange={(e)=>setText(e.target.value)}
        style={{width:"100%", height:300, marginTop:20}}
      />
    </div>
  );
}
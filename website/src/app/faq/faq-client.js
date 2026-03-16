"use client";

import { useState } from "react";

export default function FAQClient({ faqs }) {
  return (
    <div className="faq-list">
      {faqs.map((faq, i) => (
        <FAQItem key={i} question={faq.q} answer={faq.a} />
      ))}
    </div>
  );
}

function FAQItem({ question, answer }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`faq-item ${open ? "open" : ""}`}>
      <button className="faq-question" onClick={() => setOpen(!open)}>
        {question}
        <span className="faq-arrow">▼</span>
      </button>
      <div className="faq-answer">
        <p>{answer}</p>
      </div>
    </div>
  );
}

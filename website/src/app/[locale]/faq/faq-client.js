"use client";
import { useState } from "react";

export default function FAQClientLocale({ faqs }) {
  const [openIndex, setOpenIndex] = useState(null);

  return (
    <div className="faq-list">
      {faqs.map((faq, i) => (
        <div
          key={i}
          className={`faq-item ${openIndex === i ? "open" : ""}`}
          onClick={() => setOpenIndex(openIndex === i ? null : i)}
        >
          <div className="faq-question">
            <span>{faq.q}</span>
            <span className="faq-icon">{openIndex === i ? "−" : "+"}</span>
          </div>
          {openIndex === i && (
            <div className="faq-answer">
              <p>{faq.a}</p>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

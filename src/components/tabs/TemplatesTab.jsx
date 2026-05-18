import { useState } from "react";

export default function TemplatesTab({ templates, onAdd, onUse, onDelete }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  function handleSave() {
    onAdd(name, description);
    setName("");
    setDescription("");
  }

  return (
    <>
      <div className="history-header stagger" style={{ animationDelay: "0ms" }}>
        <div><span className="history-title">Test Templates</span><span className="history-meta">{templates.length} saved</span></div>
      </div>
      <p className="tab-description stagger" style={{ animationDelay: "10ms" }}>
        <strong>Purpose:</strong> Reusable snippets for individual tests you run often.{" "}
        <strong>Use case:</strong> Save a test description once, then click <strong>Use</strong> to load it into the Tests tab — edit or run when you&apos;re ready. You can also save templates from completed tests, or import them into a suite when building a batch.
      </p>
      <div className="input-card stagger" style={{ animationDelay: "20ms" }}>
        <div className="input-header"><span className="input-label">New Template</span></div>
        <input className="settings-input" placeholder="Template name" style={{ margin: "12px 16px", width: "calc(100% - 32px)" }} value={name} onChange={(event) => setName(event.target.value)} />
        <textarea style={{ width: "100%", background: "transparent", border: "none", borderTop: "1px solid var(--border)", resize: "none", color: "var(--text)", padding: "12px 16px", fontSize: 14, lineHeight: 1.6, minHeight: 80 }} placeholder="Test description…" value={description} onChange={(event) => setDescription(event.target.value)} />
        <div style={{ padding: "10px 14px", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "flex-end" }}>
          <button className="run-btn" style={{ fontSize: 13, padding: "8px 18px" }} onClick={handleSave}>Save Template</button>
        </div>
      </div>
      {templates.length === 0 ? (
        <div className="empty-state stagger" style={{ animationDelay: "40ms" }}>
          <h2>No templates yet</h2>
          <p>Create a template above, or save one from a completed test on the Tests tab</p>
        </div>
      ) : (
        <div className="tests-list">
          {templates.map((template, index) => (
            <div key={template.id} className="template-card stagger" style={{ animationDelay: `${index * 10}ms` }}>
              <div className="template-body">
                <div className="template-name">{template.name}</div>
                <div className="template-preview">{template.description}</div>
              </div>
              <div className="template-actions">
                <button className="use-btn" onClick={() => onUse(template.id)}>Use</button>
                <button className="del-btn" onClick={() => onDelete(template.id)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

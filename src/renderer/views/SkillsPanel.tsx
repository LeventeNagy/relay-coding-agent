import { ReactElement, useState } from "react";
import { Loader2, Pencil, Plus, Sparkles, Trash2, X } from "lucide-react";
import { slugify } from "../../shared/skills/types";
import type { Skill } from "../../shared/skills/types";
import type { SkillsController } from "../hooks/useSkills";

interface SkillsPanelProps {
  skills: SkillsController;
}

interface Draft {
  id?: string;
  name: string;
  description: string;
  instructions: string;
}

const blankDraft = (): Draft => ({ name: "", description: "", instructions: "" });

const draftFromSkill = (skill: Skill): Draft => ({
  id: skill.id,
  name: skill.name,
  description: skill.description,
  instructions: skill.instructions
});

export const SkillsPanel = ({ skills }: SkillsPanelProps): ReactElement => {
  const { skills: list, save, remove } = skills;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);

  const previewSlug = draft ? slugify(draft.name || "skill") : "";

  const saveDraft = async (): Promise<void> => {
    if (!draft || !draft.name.trim() || !draft.instructions.trim()) {
      return;
    }
    setBusy(true);
    await save({
      id: draft.id,
      name: draft.name.trim(),
      description: draft.description.trim(),
      instructions: draft.instructions.trim()
    });
    setBusy(false);
    setDraft(null);
  };

  return (
    <>
      <div className="skills-intro">
        <p>
          Skills are reusable instructions. Reference one in chat with{" "}
          <code>/slug</code> to apply it for that message.
        </p>
        <button className="plugins-custom" type="button" onClick={() => setDraft(blankDraft())}>
          <Plus size={15} />
          New skill
        </button>
      </div>

      {list.length === 0 && (
        <p className="plugins-empty">No skills yet. Create one to reference it with “/” in chat.</p>
      )}

      <div className="plugins-grid">
        {list.map((skill) => (
          <article className="plugin-card" key={skill.id}>
            <div className="plugin-icon">
              <Sparkles size={18} />
            </div>
            <div className="plugin-body">
              <strong>
                {skill.name} <span className="skill-slug">/{skill.slug}</span>
              </strong>
              <p>{skill.description || "No description"}</p>
            </div>
            <div className="plugin-actions">
              <button
                className="plugin-remove"
                type="button"
                aria-label={`Edit ${skill.name}`}
                onClick={() => setDraft(draftFromSkill(skill))}
              >
                <Pencil size={14} />
              </button>
              <button
                className="plugin-remove"
                type="button"
                aria-label={`Delete ${skill.name}`}
                onClick={() => remove(skill.id)}
              >
                <Trash2 size={14} />
              </button>
            </div>
          </article>
        ))}
      </div>

      {draft && (
        <div className="plugin-modal" role="dialog" aria-label="Edit skill" onClick={() => setDraft(null)}>
          <div className="plugin-modal-card" onClick={(event) => event.stopPropagation()}>
            <header className="plugin-modal-head">
              <h3>{draft.id ? "Edit skill" : "New skill"}</h3>
              <button className="icon-button" type="button" aria-label="Close" onClick={() => setDraft(null)}>
                <X size={16} />
              </button>
            </header>

            <div className="plugin-modal-body">
              <label className="plugin-field">
                <span>
                  Name
                  {draft.name.trim() && <em className="skill-slug">/{previewSlug}</em>}
                </span>
                <input
                  autoFocus
                  value={draft.name}
                  placeholder="Code Reviewer"
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    setDraft((d) => (d ? { ...d, name: value } : d));
                  }}
                />
              </label>

              <label className="plugin-field">
                <span>Description</span>
                <input
                  value={draft.description}
                  placeholder="Strict, security-focused code review"
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    setDraft((d) => (d ? { ...d, description: value } : d));
                  }}
                />
              </label>

              <label className="plugin-field">
                <span>Instructions</span>
                <textarea
                  className="skill-instructions"
                  rows={7}
                  value={draft.instructions}
                  placeholder="You are a strict code reviewer. Flag bugs, security issues, and performance problems. Be concise and cite line numbers."
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    setDraft((d) => (d ? { ...d, instructions: value } : d));
                  }}
                />
              </label>
            </div>

            <footer className="plugin-modal-foot">
              <button className="plugin-secondary" type="button" onClick={() => setDraft(null)}>
                Cancel
              </button>
              <button
                className="plugin-primary"
                type="button"
                disabled={busy || !draft.name.trim() || !draft.instructions.trim()}
                onClick={saveDraft}
              >
                {busy ? <Loader2 size={14} className="spin" /> : null}
                {draft.id ? "Save skill" : "Create skill"}
              </button>
            </footer>
          </div>
        </div>
      )}
    </>
  );
};

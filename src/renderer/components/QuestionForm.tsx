import { ReactElement, useState } from "react";
import { Check } from "lucide-react";
import type { AgentAnswer, AgentQuestion } from "../../shared/agent/types";

interface QuestionFormProps {
  requestId: string;
  questions: AgentQuestion[];
  onSubmit: (requestId: string, answers: AgentAnswer[]) => void;
}

/**
 * Renders the agent's clarifying questions as clickable option cards (radio for
 * single-choice, checkboxes for multi), each with an "Other" free-text field.
 * The user picks with the mouse and submits; answers go back to the agent.
 */
export const QuestionForm = ({ requestId, questions, onSubmit }: QuestionFormProps): ReactElement => {
  // Selected option labels per question index, and the "Other" text per question.
  const [selected, setSelected] = useState<Record<number, string[]>>({});
  const [other, setOther] = useState<Record<number, string>>({});
  const [submitted, setSubmitted] = useState(false);

  const toggle = (qi: number, label: string, multi: boolean): void => {
    setSelected((current) => {
      const have = current[qi] ?? [];
      if (multi) {
        const next = have.includes(label) ? have.filter((l) => l !== label) : [...have, label];
        return { ...current, [qi]: next };
      }
      return { ...current, [qi]: have.includes(label) ? [] : [label] };
    });
  };

  const answered = (qi: number): boolean => (selected[qi]?.length ?? 0) > 0 || Boolean(other[qi]?.trim());
  const allAnswered = questions.every((_, qi) => answered(qi));

  const submit = (): void => {
    const answers: AgentAnswer[] = questions.map((q, qi) => {
      const picks = [...(selected[qi] ?? [])];
      const otherText = other[qi]?.trim();
      if (otherText) {
        // No options → the free-text box IS the answer; otherwise it's an "Other".
        picks.push((q.options ?? []).length === 0 ? otherText : `Other: ${otherText}`);
      }
      return { question: q.question, selected: picks };
    });
    setSubmitted(true);
    onSubmit(requestId, answers);
  };

  return (
    <div className="question-form">
      {questions.map((q, qi) => {
        const options = q.options ?? [];
        return (
          <div className="question-block" key={qi}>
            <div className="question-head">
              {q.header && <span className="question-chip">{q.header}</span>}
              <span className="question-text">{q.question}</span>
            </div>
            <div className="question-options">
              {options.map((opt) => {
                const on = (selected[qi] ?? []).includes(opt.label);
                return (
                  <button
                    key={opt.label}
                    type="button"
                    className={on ? "question-opt on" : "question-opt"}
                    aria-pressed={on}
                    disabled={submitted}
                    onClick={() => toggle(qi, opt.label, Boolean(q.multiSelect))}
                  >
                    <span className={q.multiSelect ? "opt-box" : "opt-box round"}>
                      {on && <Check size={12} />}
                    </span>
                    <span className="opt-text">
                      <span className="opt-label">{opt.label}</span>
                      {opt.description && <span className="opt-desc">{opt.description}</span>}
                    </span>
                  </button>
                );
              })}
              <input
                className="question-other"
                placeholder={options.length === 0 ? "Type your answer…" : "Other…"}
                value={other[qi] ?? ""}
                disabled={submitted}
                onChange={(event) => {
                  // Capture the value now — `currentTarget` is null inside the
                  // deferred setState updater, which crashed the form.
                  const value = event.currentTarget.value;
                  setOther((c) => ({ ...c, [qi]: value }));
                }}
              />
            </div>
          </div>
        );
      })}
      <div className="question-actions">
        <button
          type="button"
          className="question-submit"
          disabled={submitted || !allAnswered}
          onClick={submit}
        >
          {submitted ? "Submitted" : "Submit answers"}
        </button>
      </div>
    </div>
  );
};

"use client";

import { RightPromptComposer, type RightPromptComposerProps } from "./prompt-composer";

export const AgentEmptyThread = (props: RightPromptComposerProps): React.ReactElement => (
  <div className="right-prompt-surface">
    <div className="right-empty-thread-center">
      <h1>What would you like to do today?</h1>
    </div>
    <div className="right-prompt-composer-wrap">
      <RightPromptComposer {...props} />
    </div>
  </div>
);

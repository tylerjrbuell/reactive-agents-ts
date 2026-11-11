<script lang="ts">
  import ConfigSection from "../ConfigSection.svelte";
  import type { PanelAgentConfig } from "../types.js";

  interface Props {
    config: PanelAgentConfig;
    open: boolean;
    onToggle: () => void;
  }
  let { config = $bindable(), open, onToggle }: Props = $props();

  function parseSkillPathsLines(s: string): string[] {
    return s.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  }
  function formatSkillPathsLines(paths: string[]): string {
    return paths.join("\n");
  }

  let skillsPathsDraft = $state("");
  let lastSkillsPathsSig = $state("");
  $effect(() => {
    const sig = JSON.stringify(config.skills?.paths ?? []);
    if (sig !== lastSkillsPathsSig) {
      lastSkillsPathsSig = sig;
      skillsPathsDraft = formatSkillPathsLines(config.skills?.paths ?? []);
    }
  });

  function commitSkillsPathsDraft() {
    const paths = parseSkillPathsLines(skillsPathsDraft);
    lastSkillsPathsSig = JSON.stringify(paths);
    config = { ...config, skills: { ...config.skills, paths } };
  }

  let skillsActivateDraft = $state("");
  let lastSkillsActivateSig = $state("");
  $effect(() => {
    const sig = JSON.stringify(config.skills?.activate ?? []);
    if (sig !== lastSkillsActivateSig) {
      lastSkillsActivateSig = sig;
      skillsActivateDraft = formatSkillPathsLines(config.skills?.activate ?? []);
    }
  });

  function commitSkillsActivateDraft() {
    const activate = parseSkillPathsLines(skillsActivateDraft);
    lastSkillsActivateSig = JSON.stringify(activate);
    config = { ...config, skills: { ...config.skills, activate: activate.length > 0 ? activate : undefined } };
  }
</script>

<ConfigSection id="skills" icon="book" title="Living skills" {open} {onToggle}>
  {#snippet head()}
      <span>{(config.skills?.paths ?? []).length} path{(config.skills?.paths ?? []).length !== 1 ? "s" : ""}</span>
  {/snippet}
        <div>
          <label for="skills-paths-lines" class="config-label">Skill directories <span class="text-text-3/70 normal-case font-normal">(`withSkills` paths — one per line)</span></label>
          <textarea id="skills-paths-lines"
            bind:value={skillsPathsDraft}
            onblur={commitSkillsPathsDraft}
            placeholder={".claude/skills\n./my-skills"}
            rows="3"
            class="config-input resize-none leading-relaxed font-mono text-[11px]"></textarea>
        </div>
        <div>
          <label for="skills-activate-lines" class="config-label">Force-activate <span class="text-text-3/70 normal-case font-normal">(skill names — one per line; always loaded in full, bypassing task-relevance auto-activation)</span></label>
          <textarea id="skills-activate-lines"
            bind:value={skillsActivateDraft}
            onblur={commitSkillsActivateDraft}
            placeholder={"my-skill-name"}
            rows="2"
            class="config-input resize-none leading-relaxed font-mono text-[11px]"></textarea>
          <p class="mt-1 acp-hint">Task-relevant skills still auto-activate; this is a deterministic override (<code>withSkills({'{'} activate {'}'}</code>).</p>
        </div>
        <label class="acp-check">
          <input
            type="checkbox"
            checked={config.skills?.global === true}
            onchange={(e) => (config = { ...config, skills: { ...config.skills, global: e.currentTarget.checked ? true : undefined } })}
          />
          <span>
            <span class="acp-check-t">Also load skills from your home folder</span>
            <span class="acp-hint"><code>~/.agents/skills</code> and <code>~/.reactive-agents/skills</code>, lowest precedence (<code>withSkills({'{'} global {'}'}</code>).</span>
          </span>
        </label>
        <p class="acp-hint">The agent always finds <code>.agents/skills</code> and <code>.claude/skills</code> in its workspace; the folders above are extra. The Lab Skills tab lists what it will find.</p>
</ConfigSection>

import { useEffect, useState } from "react";
import { euclidSteps } from "../engine/strudel/generate";
import { MAX_STEPS } from "../model/types";
import { Slider, pct } from "./controls";

export type RandomiseScope = "track" | "pattern";

interface Props {
  trackIndex: number;
  laneLength: number;
  lockedCount: number;
  onEuclid: (bits: boolean[]) => void;
  onRandomise: (
    opts: { seed: number; strength: number; density: number },
    scope: RandomiseScope,
  ) => void;
}

/** Pattern generators for the selected track. Results are written into the grid and stay editable. */
export function Generate({
  trackIndex,
  laneLength,
  lockedCount,
  onEuclid,
  onRandomise,
}: Props) {
  const [pulses, setPulses] = useState(4);
  const [steps, setSteps] = useState(laneLength);
  const [rotation, setRotation] = useState(0);
  const [strength, setStrength] = useState(0.5);
  const [density, setDensity] = useState(0.3);
  const [seed, setSeed] = useState(1);
  const [scope, setScope] = useState<RandomiseScope>("track");

  // Follow the selected track's length until the user picks another step count.
  useEffect(() => setSteps(laneLength), [trackIndex, laneLength]);
  const bits = euclidSteps(Math.min(pulses, steps), steps, rotation);

  return (
    <section className="panel-section generate" aria-label="Generate">
      <h3>
        Generate{" "}
        <span className="sub">
          · track {trackIndex + 1}
          {lockedCount
            ? ` · ${lockedCount} locked step${lockedCount > 1 ? "s" : ""} kept`
            : ""}{" "}
          · L locks the selected step
        </span>
      </h3>
      <div className="gen-blocks">
        <div className="gen-block" aria-label="Euclidean">
          <div className="gen-title">Euclidean</div>
          <Slider
            label="Hits"
            value={Math.min(pulses, steps)}
            min={0}
            max={steps}
            step={1}
            format={(v) => String(v)}
            onChange={(v) => setPulses(v)}
          />
          <Slider
            label="Steps"
            value={steps}
            min={1}
            max={MAX_STEPS}
            step={1}
            format={(v) => String(v)}
            onChange={(v) => setSteps(v)}
          />
          <Slider
            label="Rotate"
            value={rotation % steps}
            min={0}
            max={Math.max(0, steps - 1)}
            step={1}
            format={(v) => String(v)}
            onChange={(v) => setRotation(v)}
          />
          <div
            className="euclid-preview"
            aria-label={`Preview: ${bits.map((b) => (b ? "x" : ".")).join("")}`}
          >
            {bits.map((b, i) => (
              <span key={i} className={b ? "on" : ""} />
            ))}
          </div>
          <button
            className="small"
            onClick={() => onEuclid(bits)}
            title="Write this rhythm into the track. Sets the track length to the step count."
          >
            Apply to track
          </button>
        </div>
        <div className="gen-block" aria-label="Randomise">
          <div className="gen-title">Randomise</div>
          <Slider
            label="Strength"
            value={strength}
            min={0}
            max={1}
            format={pct}
            title="How many steps get re-rolled. 100% rewrites everything that isn't locked."
            onChange={(v) => setStrength(v)}
          />
          <Slider
            label="Density"
            value={density}
            min={0}
            max={1}
            format={pct}
            title="Chance that a re-rolled step is on"
            onChange={(v) => setDensity(v)}
          />
          <div className="slider">
            <label htmlFor="gen-seed">Seed</label>
            <input
              id="gen-seed"
              type="number"
              min={0}
              value={seed}
              onKeyDown={(e) => e.stopPropagation()}
              onChange={(e) =>
                setSeed(Math.max(0, Math.floor(Number(e.target.value) || 0)))
              }
              title="The same seed and settings always give the same result"
            />
            <output />
          </div>
          <div className="gen-buttons">
            <select
              value={scope}
              onKeyDown={(e) => e.stopPropagation()}
              onChange={(e) => setScope(e.target.value as RandomiseScope)}
              aria-label="Randomise scope"
            >
              <option value="track">This track</option>
              <option value="pattern">All tracks</option>
            </select>
            <button
              className="small"
              onClick={() => onRandomise({ seed, strength, density }, scope)}
              title="Apply with this seed"
            >
              Apply
            </button>
            <button
              className="small"
              onClick={() => {
                const next = seed + 1;
                setSeed(next);
                onRandomise({ seed: next, strength, density }, scope);
              }}
              title="Try the next seed"
            >
              🎲 New
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

<template>
  <figure class="flow" aria-label="A document is sent, signed, sealed and then verified">
    <svg class="flow-art" viewBox="0 0 420 360" role="img" aria-hidden="true">
      <g class="doc">
        <rect class="paper" x="70" y="34" width="250" height="300" rx="14" />
        <rect class="ink" x="100" y="70" width="120" height="12" rx="6" />
        <rect class="ink faint" x="100" y="102" width="190" height="8" rx="4" />
        <rect class="ink faint" x="100" y="120" width="176" height="8" rx="4" />
        <rect class="ink faint" x="100" y="138" width="186" height="8" rx="4" />
        <rect class="ink faint" x="100" y="156" width="120" height="8" rx="4" />
        <rect class="ink faint" x="100" y="186" width="182" height="8" rx="4" />
        <rect class="ink faint" x="100" y="204" width="150" height="8" rx="4" />
        <line class="sign-line" x1="100" y1="290" x2="236" y2="290" />
        <text class="sign-label" x="100" y="310">Asha Rao</text>
      </g>
      <path
        class="signature"
        pathLength="1"
        d="M104 280c10-22 20-40 28-34 8 6-10 30 2 32 10 2 16-26 26-24 8 2 2 22 12 22 10 0 14-18 24-18 8 0 8 12 22 12"
      />
      <g class="seal">
        <circle class="seal-outer" cx="282" cy="272" r="34" />
        <circle class="seal-inner" cx="282" cy="272" r="25" />
        <path class="seal-mark" d="M270 272l8 8 15-16" />
      </g>
      <g class="verified">
        <rect class="pill" x="214" y="12" width="140" height="36" rx="18" />
        <path class="pill-check" d="M232 30l6 6 11-12" />
        <text class="pill-text" x="258" y="35">Seal valid</text>
      </g>
    </svg>
    <ol class="flow-steps">
      <li class="step step-1"><span>1</span>Send</li>
      <li class="step step-2"><span>2</span>Sign</li>
      <li class="step step-3"><span>3</span>Seal</li>
      <li class="step step-4"><span>4</span>Verify</li>
    </ol>
  </figure>
</template>

<style scoped>
.flow {
  margin: 0;
  width: 100%;
  max-width: 440px;
}

.flow-art {
  display: block;
  width: 100%;
  height: auto;
  overflow: visible;
}

.paper {
  fill: var(--cv-surface);
  stroke: var(--cv-surface-line);
  stroke-width: 1.5;
  filter: drop-shadow(0 18px 30px rgba(13, 27, 42, 0.12));
}

.ink {
  fill: var(--vp-c-text-1);
  opacity: 0.85;
}

.ink.faint {
  fill: var(--cv-ink-soft);
  opacity: 1;
}

.sign-line {
  stroke: var(--vp-c-text-3);
  stroke-width: 1.5;
  stroke-dasharray: 4 4;
}

.sign-label {
  font: 500 11px var(--vp-font-family-base);
  fill: var(--vp-c-text-3);
}

.signature {
  fill: none;
  stroke: var(--cv-blue);
  stroke-width: 3.5;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-dasharray: 1;
  stroke-dashoffset: 0;
}

.seal-outer {
  fill: var(--cv-navy);
}

.dark .seal-outer {
  fill: var(--cv-blue);
}

.seal-inner {
  fill: none;
  stroke: var(--cv-teal);
  stroke-width: 2;
  stroke-dasharray: 3 4;
}

.seal-mark,
.pill-check {
  fill: none;
  stroke-width: 3.5;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.seal-mark {
  stroke: #ffffff;
}

.seal {
  transform-box: fill-box;
  transform-origin: center;
}

.pill {
  fill: var(--cv-teal);
}

.pill-check {
  stroke: var(--cv-navy);
}

.pill-text {
  font: 600 14px var(--vp-font-family-heading);
  fill: var(--cv-navy);
}

.flow-steps {
  list-style: none;
  display: flex;
  justify-content: space-between;
  gap: 8px;
  margin: 18px 0 0;
  padding: 0;
}

.step {
  display: flex;
  align-items: center;
  gap: 8px;
  font: 600 14px var(--vp-font-family-heading);
  color: var(--vp-c-text-2);
}

.step span {
  display: inline-grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  font-size: 12px;
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-2);
  border: 1px solid var(--vp-c-divider);
}

@media (prefers-reduced-motion: no-preference) {
  .doc {
    animation: doc-in 8s ease-out infinite;
  }

  .signature {
    animation: sign 8s ease-in-out infinite;
  }

  .seal {
    animation: seal 8s ease-out infinite;
  }

  .verified {
    animation: verified 8s ease-out infinite;
  }

  .step {
    animation: step 8s linear infinite;
  }

  .step span {
    animation: step-dot 8s linear infinite;
  }

  .step-2,
  .step-2 span {
    animation-delay: -6s;
  }

  .step-3,
  .step-3 span {
    animation-delay: -4s;
  }

  .step-4,
  .step-4 span {
    animation-delay: -2s;
  }
}

@keyframes doc-in {
  0% {
    opacity: 0;
    transform: translateY(14px);
  }
  8%,
  94% {
    opacity: 1;
    transform: none;
  }
  100% {
    opacity: 0;
  }
}

@keyframes sign {
  0%,
  22% {
    stroke-dashoffset: 1;
    opacity: 1;
  }
  45%,
  92% {
    stroke-dashoffset: 0;
    opacity: 1;
  }
  100% {
    stroke-dashoffset: 0;
    opacity: 0;
  }
}

@keyframes seal {
  0%,
  50% {
    opacity: 0;
    transform: scale(0.4);
  }
  56% {
    opacity: 1;
    transform: scale(1.08);
  }
  60%,
  92% {
    opacity: 1;
    transform: scale(1);
  }
  100% {
    opacity: 0;
    transform: scale(1);
  }
}

@keyframes verified {
  0%,
  74% {
    opacity: 0;
    transform: translateY(8px);
  }
  80%,
  92% {
    opacity: 1;
    transform: none;
  }
  100% {
    opacity: 0;
  }
}

@keyframes step {
  0%,
  24% {
    color: var(--vp-c-text-1);
  }
  25%,
  100% {
    color: var(--vp-c-text-3);
  }
}

@keyframes step-dot {
  0%,
  24% {
    background: var(--cv-blue);
    border-color: var(--cv-blue);
    color: #ffffff;
  }
  25%,
  100% {
    background: var(--vp-c-bg-soft);
    border-color: var(--vp-c-divider);
    color: var(--vp-c-text-3);
  }
}

@media (max-width: 420px) {
  .step {
    font-size: 13px;
    gap: 6px;
  }
}
</style>

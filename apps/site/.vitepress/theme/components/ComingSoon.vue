<script setup lang="ts">
defineProps<{ pkg: string }>();
</script>

<template>
  <div class="coming-soon" role="note">
    <p>
      <strong>Coming soon.</strong> <code>{{ pkg }}</code> is still being built.
    </p>
    <p>
      This page describes the planned API from the architecture notes. Names and options may change
      until the package is released; the full reference will follow its README.
    </p>
  </div>
</template>

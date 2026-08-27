<script setup lang="ts">
import type { Component } from 'vue'

defineProps<{
  /** Page title (rendered as the primary heading). */
  title: string
  /** Optional supporting line beneath the title. */
  description?: string
  /** Optional leading icon component (e.g. a lucide icon). */
  icon?: Component
}>()
</script>

<template>
  <div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
    <div class="flex items-start gap-3">
      <div
        v-if="icon"
        class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"
      >
        <component :is="icon" class="h-5 w-5" />
      </div>
      <div class="min-w-0">
        <h1 class="text-2xl font-bold tracking-tight text-foreground">
          {{ title }}
        </h1>
        <p v-if="description" class="mt-1 text-sm text-muted-foreground">
          {{ description }}
        </p>
      </div>
    </div>

    <div v-if="$slots.actions" class="flex flex-wrap items-center gap-2">
      <slot name="actions" />
    </div>
  </div>
</template>

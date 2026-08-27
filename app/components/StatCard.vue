<script setup lang="ts">
import type { Component } from 'vue'

defineProps<{
  label: string
  value: string | number
  icon?: Component
  /** Optional small caption below the label. */
  hint?: string
}>()
</script>

<template>
  <Card class="rounded-xl">
    <CardContent class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <p class="text-3xl font-bold tracking-tight text-foreground">
          {{ value }}
        </p>
        <p class="mt-1 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          {{ label }}
        </p>
        <p v-if="hint" class="mt-1 truncate text-xs text-muted-foreground">
          {{ hint }}
        </p>
      </div>
      <div
        v-if="icon"
        class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"
      >
        <component :is="icon" class="h-5 w-5" />
      </div>
    </CardContent>
  </Card>
</template>

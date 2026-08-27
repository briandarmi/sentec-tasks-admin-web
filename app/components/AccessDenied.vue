<script setup lang="ts">
import { ShieldAlertIcon } from '@lucide/vue'

withDefaults(defineProps<{
  title?: string
  description?: string
}>(), {
  title: 'Operator access only',
  description: 'This section is available only to Sentinel Tech operators.',
})
</script>

<template>
  <div class="py-10">
    <EmptyState :icon="ShieldAlertIcon" :title="title" :description="description" />
  </div>
</template>

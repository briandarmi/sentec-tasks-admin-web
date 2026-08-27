<script setup lang="ts">
withDefaults(defineProps<{
  rows?: number
  columns?: number
}>(), {
  rows: 5,
  columns: 4,
})
</script>

<template>
  <div class="space-y-3" role="status" aria-label="Loading">
    <div v-for="r in rows" :key="r" class="flex items-center gap-4">
      <Skeleton
        v-for="c in columns"
        :key="c"
        class="h-9 rounded-md"
        :class="c === 1 ? 'flex-[2]' : 'flex-1'"
      />
    </div>
  </div>
</template>

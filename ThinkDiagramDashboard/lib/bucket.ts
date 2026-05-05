import fs from 'fs'
import { BUCKET_FILE } from './paths'
import type { BucketItem } from './types'

let writeQueue: Promise<void> = Promise.resolve()

export function readBucket(): BucketItem[] {
  if (!fs.existsSync(BUCKET_FILE)) return []
  return JSON.parse(fs.readFileSync(BUCKET_FILE, 'utf-8')) as BucketItem[]
}

export function writeBucket(items: BucketItem[]): Promise<void> {
  writeQueue = writeQueue.then(() => {
    fs.writeFileSync(BUCKET_FILE, JSON.stringify(items, null, 2), 'utf-8')
  })
  return writeQueue
}

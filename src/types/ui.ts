export type ChatMessage = { text: string; mine: boolean; time: string }

export type Quality = 'idle' | 'connecting' | 'good' | 'poor' | 'failed'

import { AgentRuleConfig, RuleAction } from '@/types/rules'

export class RuleExecutor {
    /**
     * Executes the actions defined in a rule.
     */
    async execute(config: AgentRuleConfig, context: any): Promise<void> {
        if (!config.actions || config.actions.length === 0) return

        for (const action of config.actions) {
            await this.executeAction(action, context)
        }
    }

    private async executeAction(action: RuleAction, context: any): Promise<void> {
        const { type, params } = action

        console.log(`[RuleExecutor] Executing action: ${type}`, params)

        switch (type) {
            case 'send_message':
                await this.handleSendMessage(params, context)
                break
            case 'notify_human':
                await this.handleNotifyHuman(params, context)
                break
            case 'add_tag':
                await this.handleAddTag(params, context)
                break
            default:
                console.warn(`[RuleExecutor] Unknown action type: ${type}`)
        }
    }

    private async handleSendMessage(params: any, context: any) {
        // In a real implementation, this would call the WhatsApp API or Conversation Service
        console.log(`✉️ Sending message to ${context.contactId}: ${params.message}`)
    }

    private async handleNotifyHuman(params: any, context: any) {
        // Create notification or assignment
        console.log(`👨‍💻 Notifying human agent for conversation ${context.conversationId}`)
    }

    private async handleAddTag(params: any, context: any) {
        // Add tag to contact
        console.log(`🏷️ Adding tag ${params.tagName} to contact ${context.contactId}`)
    }
}

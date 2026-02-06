import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
    MessageSquare,
    TrendingUp,
    Users,
    Bot,
    ArrowUp,
    ArrowDown,
    Lightbulb,
    Sparkles
} from 'lucide-react'

// Mock data - will be replaced with real data from DB
const metrics = [
    {
        title: 'Leads',
        value: '1,234',
        change: '+12.5%',
        trend: 'up',
        icon: Users,
    },
    {
        title: 'Vendas',
        value: 'R$ 45.5K',
        change: '+8.2%',
        trend: 'up',
        icon: TrendingUp,
    },
    {
        title: 'Mensagens',
        value: '5,678',
        change: '-2.4%',
        trend: 'down',
        icon: MessageSquare,
    },
    {
        title: 'Taxa de Conversão',
        value: '3.2%',
        change: '+0.5%',
        trend: 'up',
        icon: Bot,
    },
]

export default function DashboardPage() {
    return (
        <div className="space-y-6">
            {/* Page Header */}
            <div>
                <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
                <p className="text-sm text-muted-foreground">
                    Visão geral do seu negócio
                </p>
            </div>

            {/* Metrics Grid */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                {metrics.map((metric) => {
                    const Icon = metric.icon
                    const TrendIcon = metric.trend === 'up' ? ArrowUp : ArrowDown

                    return (
                        <Card key={metric.title} className="border-border/50 bg-card transition-shadow hover:shadow-md">
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-sm font-medium text-muted-foreground">
                                    {metric.title}
                                </CardTitle>
                                <div className="rounded-lg bg-primary/10 p-2">
                                    <Icon className="h-4 w-4 text-primary" />
                                </div>
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-bold text-foreground">{metric.value}</div>
                                <div className="mt-1 flex items-center text-xs">
                                    <TrendIcon
                                        className={`mr-1 h-3 w-3 ${metric.trend === 'up' ? 'text-green-500' : 'text-red-500'
                                            }`}
                                    />
                                    <span
                                        className={
                                            metric.trend === 'up' ? 'text-green-500' : 'text-red-500'
                                        }
                                    >
                                        {metric.change}
                                    </span>
                                    <span className="ml-1 text-muted-foreground">
                                        vs último mês
                                    </span>
                                </div>
                            </CardContent>
                        </Card>
                    )
                })}
            </div>

            {/* AI Insights Panel */}
            <Card className="border-primary/20 bg-gradient-to-br from-primary/5 to-background">
                <CardHeader>
                    <div className="flex items-center gap-2">
                        <div className="rounded-lg bg-primary/10 p-2">
                            <Sparkles className="h-5 w-5 text-primary" />
                        </div>
                        <CardTitle className="text-lg">Insights da IA</CardTitle>
                    </div>
                </CardHeader>
                <CardContent>
                    <div className="space-y-3">
                        <div className="rounded-lg border border-border/50 bg-card p-4 transition-colors hover:border-primary/30">
                            <p className="text-sm text-foreground">
                                <span className="font-semibold text-primary">📈 Oportunidade Detectada:</span>{' '}
                                Leads vindos da campanha "Google Ads - Verão" têm 3x mais chances de conversão no período da tarde.
                            </p>
                        </div>
                        <div className="rounded-lg border border-border/50 bg-card p-4 transition-colors hover:border-primary/30">
                            <p className="text-sm text-foreground">
                                <span className="font-semibold text-primary">🤖 Agente Ativo:</span>{' '}
                                Seu agente "Atendimento Rápido" respondeu 234 conversas hoje com 92% de satisfação.
                            </p>
                        </div>
                        <div className="rounded-lg border border-border/50 bg-card p-4 transition-colors hover:border-primary/30">
                            <p className="text-sm text-foreground">
                                <span className="font-semibold text-amber-500">⚠️ Atenção:</span>{' '}
                                15 leads não receberam follow-up há mais de 3 dias. Considere agendar uma ação.
                            </p>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Recent Activity & Charts - Placeholder */}
            <div className="grid gap-4 lg:grid-cols-2">
                <Card className="border-border/50">
                    <CardHeader>
                        <CardTitle className="text-base">Atividades Recentes</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <p className="text-sm text-muted-foreground">
                            Em breve: Lista de atividades recentes
                        </p>
                    </CardContent>
                </Card>

                <Card className="border-border/50">
                    <CardHeader>
                        <CardTitle className="text-base">Status dos Canais</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <p className="text-sm text-muted-foreground">
                            Em breve: Status de integrações WhatsApp/Instagram
                        </p>
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}

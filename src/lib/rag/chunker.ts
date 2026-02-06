import 'server-only'
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters'

export class DocumentChunker {
    private splitter: RecursiveCharacterTextSplitter

    constructor(chunkSize = 1000, chunkOverlap = 200) {
        this.splitter = new RecursiveCharacterTextSplitter({
            chunkSize,
            chunkOverlap,
        })
    }

    async split(text: string): Promise<string[]> {
        const docs = await this.splitter.createDocuments([text])
        return docs.map((doc: any) => doc.pageContent)
    }
}

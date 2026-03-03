const express = require('express')
const { createServer } = require('http')
const { Server } = require('socket.io')
const cors = require('cors')
const { setupQuizNamespace } = require('./games/quiz')
const { setupWYRNamespace } = require('./games/would-you-rather')
const { setupPictionaryNamespace } = require('./games/pictionary')

const app = express()
const httpServer = createServer(app)

const io = new Server(httpServer, {
    cors: {
        origin: ['http://localhost:5173', 'http://localhost:4173', 'https://games-bay-rho.vercel.app'],
        methods: ['GET', 'POST']
    }
})

app.use(cors())
app.use(express.json())


app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

setupQuizNamespace(io)
setupWYRNamespace(io)
setupPictionaryNamespace(io)

const PORT = process.env.PORT || 3001
httpServer.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`)
    console.log(`🎮 Quiz namespace: /quiz`)
    console.log(`🎮 Quiz namespace: /would-you-rather`)
})
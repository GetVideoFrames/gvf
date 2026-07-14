#!/usr/bin/env node
import { runCli } from '../dist/index.js'

const code = await runCli(process.argv)
process.exitCode = code

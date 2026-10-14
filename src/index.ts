// load secrets from .env before anything reads the config
import 'dotenv/config'

import Shulker from './Shulker'

const main = async () => {
  const shulker = new Shulker()
  await shulker.init()
}

main()

import { web3, ck, mn } from './ethereum/'
import db from './db/'

// noisy yet useful
const printq = true

// Pause throttle milliseconds between recalling events from previous blocks
// (Because geth can't stay synced if we relentlessly request data from it)
const throttle = 100

const syncEvents = () => {

  web3.eth.getBlock('latest').then(res => {

    let fromBlock = res.number
    console.log(`Starting event watchers from block ${fromBlock}`)

    db.query(`CREATE TABLE IF NOT EXISTS Transfer (
      txhash     CHAR(66)    PRIMARY KEY,
      blockn     BIGINT      NOT NULL,
      sender     CHAR(42)    NOT NULL,
      recipient  CHAR(42)    NOT NULL,
      kittyid    BIGINT      NOT NULL);`)

    db.query(`CREATE TABLE IF NOT EXISTS Approval (
      txhash     CHAR(66)    PRIMARY KEY,
      blockn     BIGINT      NOT NULL,
      owner      CHAR(42)    NOT NULL,
      approved   CHAR(42)    NOT NULL,
      kittyid    BIGINT      NOT NULL);`)

    db.query(`CREATE TABLE IF NOT EXISTS Birth (
      txhash     CHAR(66)    PRIMARY KEY,
      blockn     BIGINT      NOT NULL,
      owner      CHAR(42)    NOT NULL,
      kittyid    BIGINT      NOT NULL,
      matronid   BIGINT      NOT NULL,
      sireid     BIGINT      NOT NULL,
      genes      NUMERIC(78) NOT NULL);`)

    db.query(`CREATE TABLE IF NOT EXISTS Pregnant (
      txhash      CHAR(66)    PRIMARY KEY,
      blockn      BIGINT      NOT NULL,
      owner       CHAR(42)    NOT NULL,
      matronid    BIGINT      NOT NULL,
      sireid      BIGINT      NOT NULL,
      cooldownend NUMERIC(78) NOT NULL);`)

    const auctionTableInit = (contract) => {
      db.query(`CREATE TABLE IF NOT EXISTS ${contract}AuctionCreated (
        txhash     CHAR(66)    PRIMARY KEY,
        blockn     BIGINT      NOT NULL,
        kittyid    BIGINT      NOT NULL,
        startprice NUMERIC(78) NOT NULL,
        endprice   NUMERIC(78) NOT NULL,
        duration   BIGINT      NOT NULL);`)
      db.query(`CREATE TABLE IF NOT EXISTS ${contract}AuctionSuccessful (
        txhash     CHAR(66)    PRIMARY KEY,
        blockn     BIGINT      NOT NULL,
        kittyid    BIGINT      NOT NULL,
        price      NUMERIC(78) NOT NULL,
        winner     CHAR(42)    NOT NULL);`)
      db.query(`CREATE TABLE IF NOT EXISTS ${contract}AuctionCancelled (
        txhash     CHAR(66)    PRIMARY KEY,
        blockn     BIGINT      NOT NULL,
        kittyid    BIGINT      NOT NULL);`)
    }
    auctionTableInit('sale')
    auctionTableInit('sire')

    // name [string] will be one of 'transfer', 'approval', 'birth', or 'pregnant'
    // data [object] will contain tx receipt and return values from event
    const saveEvent = (contract, name, data) => {
      let table = ''
      if (contract === 'sale' || contract === 'sire') {
        table += contract
      }
      table += name

      let q = `INSERT INTO ${table} VALUES ('${data.transactionHash}', 
        ${data.blockNumber}, `

      // These two events return the same number of the same data types, how convenient
      // pay attention to which ${} are strings that need to be enclosed in quotes eg '${}'
      if (name === 'AuctionCreated') {
        q += `${data.returnValues[0]}, ${data.returnValues[1]},
        ${data.returnValues[2]}, ${data.returnValues[3]});`

      } else if (name === 'AuctionSuccessful') {
        q += `${data.returnValues[0]}, ${data.returnValues[1]},
        '${data.returnValues[2]}');`

      } else if (name === 'AuctionCancelled') {
        q += `${data.returnValues[0]});`

      } else if (name === 'Transfer' || name === 'Approval') {
        q += `'${data.returnValues[0]}', '${data.returnValues[1]}',
        ${data.returnValues[2]});`

      } else if (name === 'Birth') {
        q += `'${data.returnValues[0]}',
        ${data.returnValues[1]}, ${data.returnValues[2]}, ${data.returnValues[3]},
        ${data.returnValues[4]});`

      } else if (name === 'Pregnant') {
        q += `'${data.returnValues[0]}',
        ${data.returnValues[1]}, ${data.returnValues[2]}, ${data.returnValues[3]});`
      }

      if (printq) { console.log(q) }
      db.query(q).catch(error=>{
        // I'll let postgres quietly sort out my duplicate queries for me
        if (error.code !== '23505') { console.error(error) }
      })
    }

    // fromBlock [int] start listening from this block number
    // name [string] of event to listen for
    const sync = (fromBlock, contract, name) => {
      // get current/future events
      ck[contract].events[name]({ fromBlock }, (err, data) => {
        if (err) { console.error(err); process.exit(1) }
        saveEvent(contract, name, data)
      })

      // i [int] remember past events from block number i
      // name [string] of event to remember
      const remember = (i, contract, name) => {
        // mn for Magic Numbers, this magic fromBlock is the one at which ck was deployed
        if (i < mn.fromBlock) return ('done')
        ck[contract].getPastEvents(name, { fromBlock: i, toBlock: i }, (err, pastEvents) => {
          if (err) { console.error(err); process.exit(1) }
          pastEvents.forEach(data=>{
            saveEvent(contract, name, data)
          })
        })
        // give node a sec to clear the call stack & give geth a sec to stay synced
        setTimeout(()=>{remember(i-1, contract, name)}, throttle)
      }
      remember(fromBlock, contract, name)
    }

    sync(fromBlock, 'core', 'Transfer')
    sync(fromBlock, 'core', 'Approval')
    sync(fromBlock, 'core', 'Birth')
    sync(fromBlock, 'core', 'Pregnant')

    sync(fromBlock, 'sale', 'AuctionCreated')
    sync(fromBlock, 'sale', 'AuctionSuccessful')
    sync(fromBlock, 'sale', 'AuctionCancelled')

    sync(fromBlock, 'sire', 'AuctionCreated')
    sync(fromBlock, 'sire', 'AuctionSuccessful')
    sync(fromBlock, 'sire', 'AuctionCancelled')
  })
 }

// Activate!
syncEvents()


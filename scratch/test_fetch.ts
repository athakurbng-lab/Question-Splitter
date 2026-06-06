import { fetchGDocTextServer } from '../src/actions/sources'

async function runTests() {
  const validUrl = 'https://docs.google.com/document/d/16Jg5KDpq24fIOTnUX9AvhmFiktugskrobyV28vXHK2E'
  const privateUrl = 'https://docs.google.com/document/d/bwF5QhecVag1AzQzvLxxWf2rYAb97LArBlcqqVeNJ9w'
  const invalidUrl = 'https://docs.google.com/document/d/invalid-id-does-not-exist-12345'
  
  console.log('--- TEST 1: Valid Public Google Doc ---')
  try {
    const text = await fetchGDocTextServer(validUrl)
    console.log('Success! Text length fetched:', text.length)
    console.log('First 100 characters preview:')
    console.log(text.substring(0, 100))
    console.log('Test 1 Passed ✅')
  } catch (error) {
    console.error('Test 1 Failed ❌:', error)
  }

  console.log('\n--- TEST 2: Invalid/Non-existent Google Doc ---')
  try {
    await fetchGDocTextServer(invalidUrl)
    console.error('Test 2 Failed ❌: Expected an error but fetch succeeded.')
  } catch (error) {
    console.log('Success! Caught expected error:', error instanceof Error ? error.message : String(error))
    console.log('Test 2 Passed ✅')
  }

  console.log('\n--- TEST 3: Private Google Doc (requires sign-in) ---')
  try {
    await fetchGDocTextServer(privateUrl)
    console.error('Test 3 Failed ❌: Expected an error but fetch succeeded.')
  } catch (error) {
    console.log('Success! Caught expected error:', error instanceof Error ? error.message : String(error))
    console.log('Test 3 Passed ✅')
  }
}

runTests().catch(console.error)

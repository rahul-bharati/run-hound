# Run Hound

AI Assisted Automated UI testing agent

## Problem statement

- AI can build anm app with a single line of prompt. The issue arises when the paths are not properly tested especially with auth and payment failure which could lead to data breach or privacy issues. 
- An human tester might not be able to test all the paths i.e. golden paths and then danger paths
- Generating a test report with the defects and triage them based on the feature and assign priority.
- Scope testing. 
- When something breaks, the QA just says xyz broke but it can't make sense of the error or the state when it broke also the cases.

## Our solution to this

- Let AI run through a headless browser and take screenshots of the pages, parse it via vision and generate a test scenarios that should be verfied
- Present a simple yet effective report on what is going to be tested and get approval from the user
- Once approved, the AI agent will execute all the tests and prepare a report that can be handed over to the tester with feature it impacts and the priority.

## Delivery

- Docker based and no online platform (temporary). 
- User can pull the Docker and then run it locally provided AI inference via local llm or using online inference like AWS Bedrock
- Initial scope it to test will be localhost and in future the live website as well mostly we will targetting staging and dev. 


## Scope 

### V0

Just open up a local form and try to create a different scenarios and get the report done. 

### V1

Point to a page and let the Agent generate test cases and execute the automation testing

### V3

Take in a feature and do a end to end feature testing. 

### V4

Point it to the app and let the agent do it. Priotize the features, generate a test cases that would provide a value to the developer in the least amount of time and then execute the e2e testing

### V5 

First delivery through docker and opensource project

## Security Issues

- We need to make sure that the user is not misuing the app to scan the websites/app that he doesn't own
- How can we mitigate this... (domain ownership verification via DNS, we create a nounce key and let it in the HTML header so the same nouce is only run)

## Inference

- Local LLM via Ollama
- cloud inference via bedrock or any openapi compliant endpoint
































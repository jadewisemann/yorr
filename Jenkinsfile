pipeline {
    agent any

    options {
        skipDefaultCheckout(true)
        timestamps()
        disableConcurrentBuilds()
        timeout(time: 45, unit: 'MINUTES')
    }

    parameters {
        booleanParam(
            name: 'FORCE_DEPLOY_ALL',
            defaultValue: false,
            description: '변경 경로와 관계없이 백엔드와 프론트를 모두 배포'
        )
    }

    triggers {
        // webhook 연동 없이 SCM polling으로 변경 감지
        pollSCM('H/2 * * * *')
    }

    environment {
        VITE_API_BASE_URL = '/api/v1'
        VITE_WS_URL = 'ws://localhost:8080/ws/v1/game'
        VITE_ENABLE_MSW = 'true'
    }

    stages {
        stage('Checkout') {
            steps {
                deleteDir()
                checkout scm

                sh '''
                    set -eu

                    echo "Branch: $BRANCH_NAME"
                    echo "Commit:"
                    git log -1 --oneline
                '''
            }
        }

        stage('Configure Environment') {
            steps {
                script {
                    if (env.BRANCH_NAME == 'main') {
                        env.DEPLOY_ENV = 'main'
                        env.BACKEND_IMAGE = 'backend:prod'
                        env.BACKEND_CONTAINER =
                            'yorr-backend-main'
                        env.BACKEND_ENV_FILE =
                            '/infra/app/.env.main'
                        env.BACKEND_NETWORK =
                            'app-main-network'
                        env.BACKEND_ALIAS =
                            'backend-main'
                        env.COMPOSE_PROJECT =
                            'yorr-main'
                        env.VERCEL_PROJECT_CREDENTIAL =
                            'vercel-prod-project-id'
                        env.FRONTEND_ENV_CREDENTIAL =
                            'frontend-main'
                    } else if (env.BRANCH_NAME == 'develop') {
                        env.DEPLOY_ENV = 'dev'
                        env.BACKEND_IMAGE = 'backend:dev'
                        env.BACKEND_CONTAINER =
                            'yorr-backend-dev'
                        env.BACKEND_ENV_FILE =
                            '/infra/app/.env.dev'
                        env.BACKEND_NETWORK =
                            'app-dev-network'
                        env.BACKEND_ALIAS =
                            'backend-dev'
                        env.COMPOSE_PROJECT =
                            'yorr-dev'
                        env.VERCEL_PROJECT_CREDENTIAL =
                            'vercel-dev-project-id'
                        env.FRONTEND_ENV_CREDENTIAL =
                            'frontend-dev'
                    } else {
                        error(
                            "배포 대상이 아닌 브랜치입니다: " +
                            env.BRANCH_NAME
                        )
                    }
                }

                sh '''
                    set -eu

                    echo "Deploy environment: $DEPLOY_ENV"
                    echo "Backend image: $BACKEND_IMAGE"
                    echo "Backend container: $BACKEND_CONTAINER"
                    echo "Backend network: $BACKEND_NETWORK"
                    echo "Backend alias: $BACKEND_ALIAS"
                '''
            }
        }

        stage('Check Backend Requirements') {
            when {
                anyOf {
                    expression {
                        currentBuild.number == 1 ||
                        params.FORCE_DEPLOY_ALL
                    }
                    changeset 'backend/**'
                    changeset 'deploy/**'
                    changeset 'Jenkinsfile'
                }
            }

            steps {
                sh '''
                    set -eu

                    test -f "$BACKEND_ENV_FILE" || {
                        echo "환경 파일이 없습니다:"
                        echo "$BACKEND_ENV_FILE"
                        exit 1
                    }

                    docker network inspect \
                        "$BACKEND_NETWORK" > /dev/null || {
                        echo "백엔드 네트워크가 없습니다:"
                        echo "$BACKEND_NETWORK"
                        exit 1
                    }

                    docker network inspect \
                        app-network > /dev/null || {
                        echo "app-network가 없습니다."
                        exit 1
                    }
                '''
            }
        }

        stage('Build Backend JAR') {
            when {
                anyOf {
                    expression {
                        currentBuild.number == 1 ||
                        params.FORCE_DEPLOY_ALL
                    }
                    changeset 'backend/**'
                    changeset 'deploy/**'
                    changeset 'Jenkinsfile'
                }
            }

            steps {
                dir('backend') {
                    sh '''
                        set -eu

                        chmod +x gradlew

                        ./gradlew \
                            clean \
                            bootJar \
                            -x test \
                            --no-daemon

                        JAR_FILE=$(
                            find build/libs \
                                -maxdepth 1 \
                                -type f \
                                -name "*.jar" \
                                ! -name "*-plain.jar" \
                                -print \
                                -quit
                        )

                        if [ -z "$JAR_FILE" ]; then
                            echo "실행 가능한 JAR가 없습니다."
                            exit 1
                        fi

                        cp "$JAR_FILE" build/app.jar
                        ls -lh build/app.jar
                    '''
                }
            }
        }

        stage('Build Backend Image') {
            when {
                anyOf {
                    expression {
                        currentBuild.number == 1 ||
                        params.FORCE_DEPLOY_ALL
                    }
                    changeset 'backend/**'
                    changeset 'deploy/**'
                    changeset 'Jenkinsfile'
                }
            }

            steps {
                sh '''
                    set -eu

                    docker build \
                        --tag "$BACKEND_IMAGE" \
                        --label "yorr.environment=$DEPLOY_ENV" \
                        backend

                    docker image inspect \
                        "$BACKEND_IMAGE" > /dev/null
                '''
            }
        }

        stage('Deploy Backend') {
            when {
                anyOf {
                    expression {
                        currentBuild.number == 1 ||
                        params.FORCE_DEPLOY_ALL
                    }
                    changeset 'backend/**'
                    changeset 'deploy/**'
                    changeset 'Jenkinsfile'
                }
            }

            steps {
                sh '''
                    set -eu

                    export BACKEND_IMAGE
                    export BACKEND_CONTAINER
                    export BACKEND_ENV_FILE
                    export BACKEND_NETWORK
                    export BACKEND_ALIAS

                    docker compose \
                        --project-name "$COMPOSE_PROJECT" \
                        --file deploy/compose.yaml \
                        config --quiet

                    docker compose \
                        --project-name "$COMPOSE_PROJECT" \
                        --file deploy/compose.yaml \
                        up \
                        --detach \
                        --force-recreate \
                        --no-deps \
                        backend
                '''
            }
        }

        stage('Verify Backend') {
            when {
                anyOf {
                    expression {
                        currentBuild.number == 1 ||
                        params.FORCE_DEPLOY_ALL
                    }
                    changeset 'backend/**'
                    changeset 'deploy/**'
                    changeset 'Jenkinsfile'
                }
            }

            steps {
                sh '''
                    set -eu

                    sleep 15

                    RUNNING=$(
                        docker inspect \
                            --format='{{.State.Running}}' \
                            "$BACKEND_CONTAINER"
                    )

                    if [ "$RUNNING" != "true" ]; then
                        echo "백엔드 실행에 실패했습니다."

                        docker logs \
                            --tail 200 \
                            "$BACKEND_CONTAINER" || true

                        exit 1
                    fi

                    echo "백엔드 컨테이너 실행 확인:"
                    docker ps \
                        --filter "name=$BACKEND_CONTAINER"

                    echo "연결된 네트워크:"
                    docker inspect \
                        --format='{{json .NetworkSettings.Networks}}' \
                        "$BACKEND_CONTAINER"

                    docker logs \
                        --tail 100 \
                        "$BACKEND_CONTAINER"
                '''
            }
        }

        stage('Validate Frontend') {
            when {
                anyOf {
                    expression {
                        currentBuild.number == 1 ||
                        params.FORCE_DEPLOY_ALL
                    }
                    changeset 'frontend/**'
                    changeset 'Jenkinsfile'
                }
            }

            steps {
                dir('frontend') {
                    sh '''
                        set -eu

                        npm ci
                        npm run check -- --line-ending=lf
                        npm run typecheck
                        npm test
                        npm run build
                    '''
                }
            }

            post {
                always {
                    junit(
                        testResults:
                            'frontend/**/test-results/**/*.xml',
                        allowEmptyResults: true
                    )

                    archiveArtifacts(
                        artifacts:
                            'frontend/playwright-report/**/*',
                        allowEmptyArchive: true
                    )
                }
            }
        }

        stage('Deploy Frontend to Vercel') {
            when {
                anyOf {
                    expression {
                        currentBuild.number == 1 ||
                        params.FORCE_DEPLOY_ALL
                    }
                    changeset 'frontend/**'
                    changeset 'Jenkinsfile'
                }
            }

            steps {
                script {
                    withCredentials([
                        file(
                            credentialsId:
                                env.FRONTEND_ENV_CREDENTIAL,
                            variable: 'FRONTEND_ENV_FILE'
                        ),
                        string(
                            credentialsId: 'vercel-token',
                            variable: 'VERCEL_TOKEN'
                        ),
                        string(
                            credentialsId: 'vercel-org-id',
                            variable: 'VERCEL_ORG_ID'
                        ),
                        string(
                            credentialsId:
                                env.VERCEL_PROJECT_CREDENTIAL,
                            variable: 'VERCEL_PROJECT_ID'
                        )
                    ]) {
                        dir('frontend') {
                            sh '''
                                set +x
                                set -eu

                                test -f "$FRONTEND_ENV_FILE" || {
                                    echo "Frontend environment file is missing"
                                    exit 1
                                }

                                set -a
                                . "$FRONTEND_ENV_FILE"
                                set +a

                                test -n "${VITE_API_BASE_URL:-}" || {
                                    echo "VITE_API_BASE_URL is missing"
                                    exit 1
                                }

                                test -n "${VITE_WS_URL:-}" || {
                                    echo "VITE_WS_URL is missing"
                                    exit 1
                                }

                                echo "Frontend environment variables loaded"

                                npx --yes vercel@latest pull \
                                    --yes \
                                    --environment=production \
                                    --token="$VERCEL_TOKEN"

                                npx --yes vercel@latest build \
                                    --prod \
                                    --token="$VERCEL_TOKEN"

                                npx --yes vercel@latest deploy \
                                    --prebuilt \
                                    --prod \
                                    --token="$VERCEL_TOKEN" \
                                    > vercel-deployment-url.txt

                                echo "Vercel deployment URL:"
                                cat vercel-deployment-url.txt
                            '''
                        }
                    }
                }
            }

            post {
                success {
                    archiveArtifacts(
                        artifacts:
                            'frontend/vercel-deployment-url.txt',
                        fingerprint: true
                    )
                }
            }
        }
    }

    post {
        failure {
            script {
                if (env.BACKEND_CONTAINER?.trim()) {
                    sh '''
                        echo "Backend logs:"

                        docker logs \
                            --tail 200 \
                            "$BACKEND_CONTAINER" \
                            2>/dev/null || true
                    '''
                }
            }
        }

        success {
            echo "${env.BRANCH_NAME} Pipeline succeeded."
        }

        cleanup {
            deleteDir()
        }
    }
}